import {type Clock, SystemClock} from '@deltic/clock';
import type {AnyMessageFrom, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import {OUTBOX_ID_HEADER_KEY, OUTBOX_TABLE_HEADER_KEY, type OutboxRepository} from '@deltic/messaging/outbox';
import {messageWithHeaders} from '@deltic/messaging/helpers';

interface ThrottledOutboxRecord<Stream extends StreamDefinition> {
    id: number,
    consumed_initially: boolean,
    should_dispatch_delayed: boolean,
    consumed_delayed: boolean,
    idempotency_key: string,
    payload: AnyMessageFrom<Stream>,
    delay_until: Date,
}

export type ThrottledOutboxDispatchType = 'initial' | 'delayed';
export const THROTTLED_OUTBOX_DISPATCH_TYPE_KEY = '__throttled_dispatch_type';
export type IdempotencyKeyResolver<Stream extends StreamDefinition> = (message: AnyMessageFrom<Stream>) => string;

/**
 * 📖Throttled Outbox Repository
 *
 * This implementation of the Outbox Repository reduces the amount of messages consumed by applying a
 * throttling technique. Whenever a series of events is dispatched, for each "idempotency key" the
 * initial message is relayed. Subsequent messages only update the payload of the existing message.
 * As soon as the throttle window has been passed, the last known payload is relayed. When the delayed
 * message has been dispatched and another message comes in before the next window is over, the window
 * rolls over. When a new message comes in AFTER the next window has passed, another message is
 * consumable immediately.
 *
 * This implementation is VERY Postgres specific and is not likely to be portable to other SQL databases.
 */
export class ThrottledOutboxRepositoryUsingPg<Stream extends StreamDefinition> implements OutboxRepository<Stream> {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly tableName: string,
        private readonly throttleWindowMs: number,
        private readonly keyResolver: IdempotencyKeyResolver<Stream>,
        private readonly clock: Clock = SystemClock,
    ) {
    }

    async cleanupConsumedMessages(limit: number): Promise<number> {
        const connection = await this.pool.claim();
        const now = new Date(this.clock.now() - this.throttleWindowMs);

        try {
            const response = await connection.query(
                `DELETE
                 FROM ${this.tableName}
                 WHERE id IN (SELECT id
                              FROM ${this.tableName}
                              WHERE delay_until < $1
                                AND consumed_initially = true
                                AND (
                                  should_dispatch_delayed = false
                                      OR consumed_delayed = true
                                  )
                              ORDER BY id ASC
                     LIMIT $2
                     )`,
                [now, limit],
            );

            await this.pool.release(connection);
            return response.rowCount ?? 0;
        } catch (error) {
            await this.pool.release(connection, error);

            throw error;
        }
    }

    async markConsumed(messages: MessagesFrom<Stream>): Promise<void> {
        const perType = Object.entries(
            Object.groupBy(
                messages,
                message => message.headers[THROTTLED_OUTBOX_DISPATCH_TYPE_KEY] as ThrottledOutboxDispatchType,
            ),
        );

        const transaction = await this.pool.begin();

        try {
            for (const [type, messages] of perType) {
                const ids = messages.map(m => m.headers[OUTBOX_ID_HEADER_KEY]) as number[];

                if (ids.length === 0) {
                    continue;
                }

                const column = type === 'initial' ? 'consumed_initially' : 'consumed_delayed';

                await transaction.query(`
                    UPDATE ${this.tableName}
                    SET ${column} = true
                    WHERE id = ANY ($1::int[])
                `, [ids]);
            }
        } catch (e) {
            await this.pool.rollback(transaction);

            throw e;
        }

        await this.pool.commit(transaction);
    }

    async persist(messages: MessagesFrom<Stream>): Promise<void> {
        const latestPerIdempotencyKey = Array.from(
            messages.reduce(
                (map, message, index) => {
                    map.set(this.keyResolver(message), [index, message]);

                    return map;
                },
                new Map<string, [number, AnyMessageFrom<Stream>]>(),
            ).values(),
        ).toSorted((a, b) => a[0] - b[0]).map(item => item[1]);

        if (latestPerIdempotencyKey.length === 0) {
            return;
        }

        const now = this.clock.now();
        const throttleWindowMs = this.throttleWindowMs; // $2
        const nowMinusWindowMs = now - throttleWindowMs;
        const delayUntil = new Date(now + throttleWindowMs);
        const nowMinusWindowDate = new Date(nowMinusWindowMs);
        const nowDate = new Date(now);
        const connection = await this.pool.primary();

        const references: string [] = [];
        const values: any[] = [
            false, // $1
            delayUntil, // $2
            nowMinusWindowDate, // $3
            nowDate, // $4
            throttleWindowMs, // $5
        ];
        let index: number = 5;

        for (const message of latestPerIdempotencyKey) {
            references.push(`$1, $1, $1, $${++index}, $${++index}, $2`);
            values.push(this.keyResolver(message), message);
        }

        /**
         * - ALWAYS
         *   - SET payload = EXCLUDED.payload
         * - When the window has NOT been passed
         *   - SET should_dispatch_delayed = TRUE
         * - When now is between the window end and next window end
         *   - SET should_dispatch_delayed = ${tableName}.consumed_initially
         *   - SET consumed_initially = ${tableName}.consumed_delayed
         *   - SET consumed_delayed = FALSE
         *   - SET delay_until = ${tableName}.delay_until + interval
         * - When the next window end has been passed
         *   - SET consumed_initially = FALSE
         *   - SET consumed_delayed = FALSE
         *   - SET delay_until = EXCLUDED.delay_until
         *   - SET should_dispatch_delayed = FALSE
         */
        await connection.query(`
            INSERT INTO ${this.tableName} (
               consumed_initially,
               consumed_delayed,
               should_dispatch_delayed,
               idempotency_key,
               payload,
               delay_until
            )
            VALUES (${references.join('), (')}) ON CONFLICT (idempotency_key)
                DO UPDATE SET
                payload = EXCLUDED.payload,
                consumed_initially = (
                    CASE
                        WHEN ${this.tableName}.delay_until <= $3 -- now-window
                            THEN FALSE
                        WHEN ${this.tableName}.delay_until <= $4 -- now
                            THEN ${this.tableName}.consumed_delayed
                            ELSE ${this.tableName}.consumed_initially
                    END
                ),
                consumed_delayed = (
                    CASE
                        WHEN ${this.tableName}.delay_until <= $4 -- now
                            THEN FALSE
                            ELSE ${this.tableName}.consumed_delayed
                    END
                ),
                should_dispatch_delayed = (
                    CASE
                        WHEN ${this.tableName}.delay_until <= $3 -- now-window
                            THEN FALSE
                        WHEN ${this.tableName}.delay_until <= $4 -- now
                            THEN ${this.tableName}.consumed_initially
                        ELSE TRUE
                    END
                ),
                delay_until = (
                    CASE
                        WHEN ${this.tableName}.delay_until <= $3 -- now-window
                            THEN EXCLUDED.delay_until
                        WHEN ${this.tableName}.delay_until <= $4 -- now
                            THEN ${this.tableName}.delay_until + ($5 * interval '1  ms')
                            ELSE ${this.tableName}.delay_until
                    END
                )
        `, values);
    }

    async* retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>> {
        const result = await (await this.pool.primary())
            .query<ThrottledOutboxRecord<Stream>>(
                `SELECT id, payload, consumed_initially
                 FROM ${this.tableName}
                 WHERE consumed_initially = false
                    OR (
                     should_dispatch_delayed = true
                         AND consumed_delayed = false
                         AND delay_until <= $1
                     )
                 ORDER BY id ASC
                     LIMIT $2`,
                [this.clock.date(), size],
            );

        for await (const record of result.rows) {
            yield messageWithHeaders(
                record.payload as AnyMessageFrom<Stream>,
                {
                    [OUTBOX_ID_HEADER_KEY]: record.id,
                    [OUTBOX_TABLE_HEADER_KEY]: this.tableName,
                    [THROTTLED_OUTBOX_DISPATCH_TYPE_KEY]: record.consumed_initially === false
                        ? 'initial' : 'delayed',
                },
            );
        }
    }

    async truncate(): Promise<void> {
        await (await this.pool.primary()).query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY CASCADE`);
    }

    async numberOfConsumedMessages(): Promise<number> {
        const connection = await this.pool.primary();
        return Number(
            (await connection.query(`
                SELECT count(id) as count
                FROM ${this.tableName}
                WHERE consumed_initially = true
            `)).rows[0].count,
        );
    }

    async numberOfPendingMessages(): Promise<number> {
        const connection = await this.pool.primary();

        return Number(
            (await connection.query(`
                SELECT count(id) as count
                FROM ${this.tableName}
                WHERE consumed_initially = false
                OR (should_dispatch_delayed = true AND consumed_delayed = false)
            `)).rows[0].count,
        );
    }
}
