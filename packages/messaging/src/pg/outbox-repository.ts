import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {AnyMessageFrom, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import {messageWithHeaders} from '@deltic/messaging/helpers';
import {
    OUTBOX_CONSUMED_HEADER_KEY,
    OUTBOX_ID_HEADER_KEY,
    OUTBOX_TABLE_HEADER_KEY,
    type OutboxRepository,
} from '@deltic/messaging/outbox';

interface OutboxRecordUsingPg<Stream extends StreamDefinition> {
    id: number,
    consumed: boolean,
    payload: AnyMessageFrom<Stream>,
}

export class OutboxRepositoryUsingPg<Stream extends StreamDefinition> implements OutboxRepository<Stream> {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly tableName: string,
    ) {
    }

    async cleanupConsumedMessages(limit: number): Promise<number> {
        const connection = await this.pool.claim();

        try {
            /**
             * BEWARE, this is a raw SQL query. Postgres does not support
             * delete statements with a LIMIT, you need to select the IDs
             * in a sub-query and delete the matching records. Knex does
             * not warn you about this, unfortunately.
             */
            const response = await connection.query(
                `DELETE
                 FROM ${this.tableName}
                 WHERE id IN (SELECT id
                              FROM ${this.tableName}
                              WHERE consumed = $1
                              ORDER BY id ASC
                     LIMIT $2
                     )`,
                [true, limit],
            );

            await this.pool.release(connection);

            return response.rowCount ?? 0;
        } catch (error) {
            await this.pool.release(connection, error);

            throw error;
        }
    }

    async markConsumed(messages: MessagesFrom<Stream>): Promise<void> {
        const ids = messages.map(m => m.headers[OUTBOX_ID_HEADER_KEY]) as number[];

        if (ids.length === 0) {
            return;
        }

        await (
            await this.pool.primary()
        ).query(`UPDATE ${this.tableName} set consumed = true where id = ANY($1::int[])`, [ids]);
    }

    async persist(messages: MessagesFrom<Stream>): Promise<void> {
        if (messages.length === 0) {
            return;
        }

        const inTransaction = this.pool.inTransaction();
        const transaction = inTransaction ?
            this.pool.withTransaction()
            : await this.pool.begin();

        const values: any[] = [false];
        const references: string[] = [];
        let index: number = 1;

        for (const message of messages) {
            references.push(`$1, $${++index}`);
            values.push(message);
        }

        try {
            await transaction
                .query(
                    `INSERT INTO ${this.tableName} (consumed, payload) VALUES (${references.join('), (')});`,
                    values,
                );
            await transaction.query(`NOTIFY outbox_publish__${this.tableName}`);
            await transaction.query(`NOTIFY outbox_publish, '${this.tableName}'`);

            if (!inTransaction) {
                await this.pool.commit(transaction);
            }
        } catch (e) {
            if (!inTransaction) {
                await this.pool.rollback(transaction);
            }
            throw e;
        }
    }

    async* retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>> {
        const records = await (await this.pool.primary())
            .query<OutboxRecordUsingPg<Stream>>(
                `SELECT id, payload, consumed
                    FROM ${this.tableName}
                    WHERE consumed = $1
                    ORDER BY id ASC
                    LIMIT $2`,
                [false, size],
            );

        for await (const record of records.rows) {
            yield messageWithHeaders(
                record.payload,
                {
                    [OUTBOX_ID_HEADER_KEY]: record.id,
                    [OUTBOX_TABLE_HEADER_KEY]: this.tableName,
                    [OUTBOX_CONSUMED_HEADER_KEY]: record.consumed,
                },
            );
        }
    }

    async truncate(): Promise<void> {
        await (await this.pool.primary()).query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY CASCADE`);
    }

    async numberOfConsumedMessages(): Promise<number> {
        return Number(
            (await
                    (await this.pool.primary())
                        .query(`SELECT count(id) as count FROM ${this.tableName} WHERE consumed = true`)
            ).rows[0].count
        );
    }

    async numberOfPendingMessages(): Promise<number> {
        return Number(
            (await
                    (await this.pool.primary())
                        .query(`SELECT count(id) as count FROM ${this.tableName} WHERE consumed = false`)
            ).rows[0].count
        );
    }
}
