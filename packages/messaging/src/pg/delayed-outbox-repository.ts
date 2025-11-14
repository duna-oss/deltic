import type {BackOffStrategy} from '@deltic/backoff';
import {type Clock, SystemClock} from '@deltic/clock';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {AnyMessageFrom, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import {messageWithHeaders} from '@deltic/messaging/helpers';
import {
    OUTBOX_CONSUMED_HEADER_KEY,
    OUTBOX_ID_HEADER_KEY,
    OUTBOX_TABLE_HEADER_KEY,
    type OutboxRepository,
} from '@deltic/messaging/outbox';

interface DelayedOutboxRecord<Stream extends StreamDefinition> {
    id: number,
    consumed: boolean,
    payload: AnyMessageFrom<Stream>,
    delay_until?: Date,
}

export class DelayedOutboxRepositoryUsingPg<Stream extends StreamDefinition> implements OutboxRepository<Stream> {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly tableName: string,
        private readonly backoff: BackOffStrategy,
        private readonly clock: Clock = SystemClock,
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
                              WHERE consumed = true
                              ORDER BY id ASC
                     LIMIT $1
                     )`,
                [limit],
            );

            await this.pool.release(connection);

            return response.rowCount ?? 0;
        } catch (error) {
            await this.pool.release(connection, error);

            throw error;
        }
    }

    async markConsumed(messages: MessagesFrom<Stream>): Promise<void> {
        if (messages.length === 0) {
            return;
        }

        const ids = messages.map(m => m.headers[OUTBOX_ID_HEADER_KEY]) as number[];

        await (
            await this.pool.primary()
        ).query(`UPDATE ${this.tableName} SET consumed = true WHERE id = ANY($1::int[])`, [ids]);
    }

    async persist(messages: MessagesFrom<Stream>): Promise<void> {
        if (messages.length === 0) {
            return;
        }

        messages = messages.map(message => {
            const currentAttempt = Number(message.headers['attempt'] ?? 0);
            const delayUntil = this.clock.now() + this.backoff.backOff(currentAttempt);

            return messageWithHeaders(message, {
                attempt: currentAttempt + 1,
                delay_until: delayUntil,
            });
        });

        const values: any[] = [false];
        const references: string[] = [];
        let index: number = 1;

        for (const message of messages) {
            references.push(`$1, $${++index}, $${++index}`);
            values.push(message, new Date(+message.headers['delay_until']!));
        }

        await (await this.pool.primary())
            .query(
                `INSERT INTO ${this.tableName} (consumed, payload, delay_until) VALUES (${references.join('), (')});`,
                values,
            );
    }

    async* retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>> {
        const records = await (await this.pool.primary())
            .query<DelayedOutboxRecord<Stream>>(
                `SELECT id, consumed, payload
                    FROM ${this.tableName}
                    WHERE consumed = $1 AND delay_until <= $2
                    ORDER BY id ASC
                    LIMIT $3`,
                [false, this.clock.date(), size],
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
