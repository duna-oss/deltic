import type {KeyValueStore} from './index.js';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {ValueReader} from '@deltic/context';
import type {IdConversion} from '@deltic/uid';

export type PropertyType = string | number | boolean | null | undefined | ObjectType | Array<PropertyType>;
export type ObjectType = {[index: string | number]: PropertyType};
export type KeyType<Key extends ObjectType> = {
    [K in keyof Key]: K extends 'deltic_payload' ? never : Key[K];
};

type ColumnAndToDatabaseFn<Columns extends ObjectType> = {
    [Key in keyof Columns]: {
        payloadKey: Key;
        columnName?: string; // optionally name the column something else
        toDatabaseValue?(value: Columns[Key]): PropertyType;
    };
}[keyof Columns];
type ResolvedColumnAndToDatabaseFn<Columns extends ObjectType> = {
    [Key in keyof Columns]: {
        payloadKey: Key;
        columnName: string;
        toDatabaseValue?(value: Columns[Key]): PropertyType;
    };
}[keyof Columns];
type Column<Columns extends ObjectType> = keyof Columns | ColumnAndToDatabaseFn<Columns>;

export type StoredRecord<Value extends ObjectType> = {
    deltic_payload: {value: Value};
} & {
    [index: string | number | symbol]: any;
};

export class KeyValueStoreWithColumnsUsingPg<
    Key extends KeyType<Key>,
    Value extends ObjectType,
    TenantId extends string | number = string | number,
> implements KeyValueStore<Key, Value> {
    private readonly identityColumns: ResolvedColumnAndToDatabaseFn<Key>[];
    private readonly storedColumns: ResolvedColumnAndToDatabaseFn<Value>[];

    constructor(
        private readonly pool: AsyncPgPool,
        private readonly tableName: string,
        identityKeys: Column<Key>[],
        storedKeys: Column<Value>[],
        private readonly tenantContext?: ValueReader<TenantId>,
        private readonly tenantIdConversion?: IdConversion<TenantId>,
    ) {
        this.identityColumns = identityKeys.map(key => this.resolveColumnParameter<Key>(key));
        this.storedColumns = storedKeys.map(key => this.resolveColumnParameter<Value>(key));
    }

    async persist(key: Key, value: Value): Promise<void> {
        const conn = await this.pool.primary();
        const identityColumns: string[] = [];
        const valueColums: string[] = [];
        const references: string[] = [];
        const values: any[] = [];

        const tenantId = this.tenantContext?.mustResolve();

        if (tenantId) {
            identityColumns.push('tenant_id');
            values.push(this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId);
            references.push(`$${values.length}`);
        }

        for (const {payloadKey, columnName, toDatabaseValue} of this.identityColumns) {
            identityColumns.push(columnName);
            const columnValue = key[payloadKey];
            values.push(toDatabaseValue?.(columnValue) ?? columnValue);
            references.push(`$${values.length}`);
        }

        for (const {payloadKey, columnName, toDatabaseValue} of this.storedColumns) {
            valueColums.push(columnName);
            const columnValue = value[payloadKey];
            values.push(toDatabaseValue?.(columnValue) ?? columnValue);
            references.push(`$${values.length}`);
        }

        valueColums.push('deltic_payload');
        values.push({value});
        references.push(`$${values.length}`);

        await conn.query(
            `
            INSERT INTO ${this.tableName} (${[...identityColumns, ...valueColums].map(name => `"${name}"`).join(', ')})
                VALUES (${references.join(', ')})
            ON CONFLICT (${identityColumns.join(', ')}) DO UPDATE
                SET ${valueColums.map(name => `"${name}" = EXCLUDED."${name}"`).join(', ')}
        `,
            values,
        );
    }

    async retrieve(key: Key): Promise<Value | undefined> {
        const conn = await this.pool.primary();
        const whereClauses: string[] = [];
        const values: any[] = [];
        const tenantId = this.tenantContext?.mustResolve();

        if (tenantId) {
            values.push(this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId);
            whereClauses.push(`tenant_id = $${values.length}`);
        }

        for (const {payloadKey, columnName, toDatabaseValue} of this.identityColumns) {
            values.push(
                Object.prototype.hasOwnProperty.call(key, payloadKey)
                    ? (toDatabaseValue?.(key[payloadKey]) ?? payloadKey)
                    : null,
            );
            whereClauses.push(`${columnName} = $${values.length}`);
        }

        const {rows} = await conn.query<StoredRecord<Value>>(
            `
            SELECT deltic_payload FROM ${this.tableName}
            WHERE ${whereClauses.join(' AND ')}
            LIMIT 1
        `,
            values,
        );

        return rows[0]?.deltic_payload.value;
    }

    async remove(key: Key): Promise<void> {
        const conn = await this.pool.primary();
        const whereClauses: string[] = [];
        const values: any[] = [];
        const tenantId = this.tenantContext?.mustResolve();

        if (tenantId) {
            values.push(this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId);
            whereClauses.push(`tenant_id = $${values.length}`);
        }

        for (const {payloadKey, columnName, toDatabaseValue} of this.identityColumns) {
            values.push(
                Object.prototype.hasOwnProperty.call(key, payloadKey)
                    ? (toDatabaseValue?.(key[payloadKey]) ?? payloadKey)
                    : null,
            );
            whereClauses.push(`${columnName} = $${values.length}`);
        }

        await conn.query(
            `
            DELETE FROM ${this.tableName}
            WHERE ${whereClauses.join(' AND ')}
        `,
            values,
        );
    }

    async clear(): Promise<void> {
        const conn = await this.pool.primary();
        await conn.query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY CASCADE`);
    }

    private resolveColumnParameter<Columns extends ObjectType>(
        column: Column<Columns>,
    ): ResolvedColumnAndToDatabaseFn<Columns> {
        if (typeof column === 'object') {
            return {
                ...column,
                columnName: column.columnName || column.payloadKey,
            };
        }
        // allow just a string to be passed, toDatabaseValue does nothing in this case
        return {
            payloadKey: column,
            columnName: column.toString(),
            toDatabaseValue: value => value,
        };
    }
}
