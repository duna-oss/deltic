import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {ContextValueReader} from '@deltic/context';
import type {IdConversion} from '@deltic/uid';
import type {AggregateStreamWithSnapshotting, Snapshot, SnapshotRepository} from '../snapshotting.js';
import type {QueryResult} from 'pg';

interface SnapshotRecord {
    aggregate_root_id: string;
    version: string;
    state: unknown;
}

export interface SnapshotRepositoryUsingPgOptions<Stream extends AggregateStreamWithSnapshotting<Stream>> {
    readonly idConversion?: IdConversion<Stream['aggregateRootId']>;
    readonly tenantIdConversion?: IdConversion<string | number>;
    readonly tenantContext?: ContextValueReader<string>;
}

export class SnapshotRepositoryUsingPg<Stream extends AggregateStreamWithSnapshotting<Stream>>
    implements SnapshotRepository<Stream>
{
    private readonly idConversion?: IdConversion<Stream['aggregateRootId']>;
    private readonly tenantIdConversion?: IdConversion<string | number>;
    private readonly tenantContext?: ContextValueReader<string>;

    constructor(
        private readonly pool: AsyncPgPool,
        private readonly tableName: string,
        private readonly schemaVersion: number,
        readonly options: SnapshotRepositoryUsingPgOptions<Stream> = {},
    ) {
        this.idConversion = options.idConversion;
        this.tenantContext = options.tenantContext;
        this.tenantIdConversion = options.tenantIdConversion;
    }

    async store(snapshot: Snapshot<Stream>): Promise<void> {
        const connection = await this.pool.primary();
        const tenantId = this.tenantContext?.mustResolve();
        const dbId = this.idConversion?.toDatabase(snapshot.aggregateRootId) ?? snapshot.aggregateRootId;

        if (tenantId !== undefined) {
            const dbTenantId = this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId;
            await connection.query(
                `INSERT INTO ${this.tableName} (tenant_id, aggregate_root_id, version, state, schema_version)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (tenant_id, aggregate_root_id, schema_version) DO UPDATE SET
                     version = EXCLUDED.version,
                     state = EXCLUDED.state`,
                [dbTenantId, dbId, snapshot.version, JSON.stringify(snapshot.state), this.schemaVersion],
            );
        } else {
            await connection.query(
                `INSERT INTO ${this.tableName} (aggregate_root_id, version, state, schema_version)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (aggregate_root_id, schema_version) DO UPDATE SET
                     version = EXCLUDED.version,
                     state = EXCLUDED.state`,
                [dbId, snapshot.version, JSON.stringify(snapshot.state), this.schemaVersion],
            );
        }
    }

    async retrieve(id: Stream['aggregateRootId']): Promise<Snapshot<Stream> | undefined> {
        const connection = await this.pool.primary();
        const tenantId = this.tenantContext?.mustResolve();
        const dbId = this.idConversion?.toDatabase(id) ?? id;

        let result: QueryResult<SnapshotRecord>;

        if (tenantId !== undefined) {
            const dbTenantId = this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId;
            result = await connection.query<SnapshotRecord>(
                `SELECT aggregate_root_id, version, state FROM ${this.tableName}
                 WHERE tenant_id = $1 AND aggregate_root_id = $2 AND schema_version = $3`,
                [dbTenantId, dbId, this.schemaVersion],
            );
        } else {
            result = await connection.query<SnapshotRecord>(
                `SELECT aggregate_root_id, version, state FROM ${this.tableName}
                 WHERE aggregate_root_id = $1 AND schema_version = $2`,
                [dbId, this.schemaVersion],
            );
        }

        if (result.rows.length === 0) {
            return undefined;
        }

        const row = result.rows[0];
        const aggregateRootId =
            this.idConversion?.fromDatabase(row.aggregate_root_id) ??
            (row.aggregate_root_id as Stream['aggregateRootId']);

        return {
            aggregateRootId,
            version: Number(row.version),
            state: row.state as Stream['snapshot'],
        };
    }

    async clear(): Promise<void> {
        const connection = await this.pool.primary();
        const tenantId = this.tenantContext?.mustResolve();

        if (tenantId !== undefined) {
            const dbTenantId = this.tenantIdConversion?.toDatabase(tenantId) ?? tenantId;
            await connection.query(`DELETE FROM ${this.tableName} WHERE tenant_id = $1 AND schema_version = $2`, [
                dbTenantId,
                this.schemaVersion,
            ]);
        } else {
            await connection.query(`DELETE FROM ${this.tableName} WHERE schema_version = $1`, [this.schemaVersion]);
        }
    }
}
