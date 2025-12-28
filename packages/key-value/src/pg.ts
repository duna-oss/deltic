import type {KeyType, KeyValueStore, ValueType, KeyConversion} from './index.js';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {ContextValueReader} from '@deltic/context';
import type {IdConversion} from '@deltic/uid';

type StoredRecord<V> = {
    key: string | number,
    // This nesting is needed to store arbitrary values, it requires a top-level array or object
    value: {value: V},
};

export interface KeyValueStoreUsingPgOptions<
    Key extends KeyType,
    DatabaseKey extends string | number,
    TenantId extends string | number,
> {
    tableName: string;
    keyConversion?: KeyConversion<Key, DatabaseKey>;

    tenantContext?: ContextValueReader<TenantId>,
    tenantIdConversion?: IdConversion<TenantId>,
}

export class KeyValueStoreUsingPg<
    Key extends KeyType,
    Value extends ValueType,
    DatabaseKey extends string | number = string | number,
    TenantId extends string | number = string | number,
> implements KeyValueStore<Key, Value> {
    private readonly tableName: string;
    private readonly keyConversion: KeyConversion<Key, DatabaseKey>;
    private readonly tenantContext?: ContextValueReader<TenantId>;
    private readonly tenantIdConversion?: IdConversion<TenantId>;

    constructor(
        private readonly pool: AsyncPgPool,
        readonly options: KeyValueStoreUsingPgOptions<Key, DatabaseKey, TenantId>,
    ) {
        this.tableName = options.tableName;
        this.keyConversion = options.keyConversion ?? (key => key as unknown as DatabaseKey);
        this.tenantContext = options.tenantContext;
        this.tenantIdConversion = options.tenantIdConversion;
    }

    async persist(key: Key, value: Value): Promise<void> {
        const connection = await this.pool.primary();
        const resolvedKey = this.keyConversion(key);
        const tenantId = this.tenantContext?.mustResolve();
        const values: any[] = [resolvedKey, {value}];
        const references: string[] = ['$1', '$2'];
        const uniqueColumns = ['"key"'];

        if (tenantId !== undefined) {
            references.push('$3');
            uniqueColumns.unshift('tenant_id');
            values.unshift(this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId);
        }

        try {
            await connection.query(`
                INSERT INTO ${this.tableName} (${uniqueColumns.join(', ')}, "value")
                VALUES (${references.join(', ')}) ON CONFLICT (tenant_id, "key") DO
                UPDATE set "value" = EXCLUDED."value"
            `, values);
        } finally {
            await this.pool.release(connection);
        }
    }

    async retrieve(key: Key): Promise<Value | undefined> {
        const conn = await this.pool.primary();
        const resolvedKey = this.keyConversion(key);

        try {
            const result = await conn.query<StoredRecord<Value>>(`
                SELECT "value"
                from ${this.tableName}
                WHERE "key" = $1
                LIMIT 1`,
                [resolvedKey],
            );

            return result.rows[0]?.value?.value;
        } finally {
            await this.pool.release(conn);
        }
    }

    async remove(key: Key): Promise<void> {
        const conn = await this.pool.primary();
        const resolvedKey = this.keyConversion(key);

        try {
            await conn.query(`DELETE FROM ${this.tableName} WHERE "key" = $1`, [resolvedKey]);
        } finally {
            await this.pool.release(conn);
        }
    }

    async clear(): Promise<void> {
        const conn = await this.pool.primary();
        await conn.query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY CASCADE`);
    }
}

export function createKeyValueSchemaQuery(tableName: string, ifNotExists: boolean = false): string {
    return `
        CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS' : ''} ${tableName} (
            tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
            "key" VARCHAR(255),
            "value" JSON,
            PRIMARY KEY (tenant_id, "key")
        );
    `;
}
