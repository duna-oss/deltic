import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {OffsetIdType, OffsetRepository, OffsetType} from './index.js';

type OffsetRecord<Offset extends string | number, Id extends OffsetIdType> = {
    consumer: string,
    identifier: Id,
    offset: Offset,
};

export interface OffsetRepositoryUsingPgOptions {
    tableName: string,
    consumerName: string,
    selectForUpdate?: true,
}

export class OffsetRepositoryUsingPg<
    Offset extends OffsetType,
    Id extends OffsetIdType = string,
> implements OffsetRepository<Offset, Id> {
    private readonly tableName: string;
    private readonly consumerName: string;
    private readonly selectForUpdate: boolean;

    constructor(
        private readonly pool: AsyncPgPool,
        readonly options: OffsetRepositoryUsingPgOptions,
    ) {
        this.tableName = options.tableName;
        this.consumerName = options.consumerName;
        this.selectForUpdate = options.selectForUpdate ?? false;
    }

    async retrieve(identifier: Id): Promise<Offset | undefined> {
        const conn = await this.pool.primary();

        const result = await conn.query<OffsetRecord<Offset, Id>>(
            `${this.selectForUpdate ? 'SELECT FOR UPDATE' : 'SELECT'} "offset"
                FROM ${this.tableName}
                WHERE consumer = $1 AND identifier = $2`,
            [this.consumerName, identifier],
        );

        return result.rows[0]?.offset;
    }

    async store(identifier: Id, offset: Offset): Promise<void> {
        const conn = await this.pool.primary();

        await conn.query(
            `INSERT INTO ${this.tableName} (consumer, identifier, "offset")
             VALUES ($1, $2, $3) ON CONFLICT (consumer, identifier)
                DO
            UPDATE SET "offset" = EXCLUDED.offset`,
            [this.consumerName, identifier, offset],
        );
    }
}