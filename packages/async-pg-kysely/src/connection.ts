import type {CompiledQuery, DatabaseConnection, PostgresCursorConstructor, QueryResult} from 'kysely';
import type {Connection as PgConnection} from '@deltic/async-pg-pool';

/**
 * Symbol used to access the underlying pg connection from an AsyncPgConnection.
 */
export const pgConnectionSymbol = Symbol.for('@deltic/async-pg-kysely/connection');

/**
 * Options for creating an AsyncPgConnection.
 */
export interface AsyncPgConnectionOptions {
    /**
     * A pg-cursor constructor for streaming query support.
     *
     * Install `pg-cursor` and pass the default export to enable
     * streaming queries via Kysely's `.stream()` API.
     */
    cursor?: PostgresCursorConstructor;
}

/**
 * A Kysely DatabaseConnection that wraps a pg connection from AsyncPgPool.
 *
 * This implements the minimal interface Kysely requires: `executeQuery` and
 * `streamQuery`. Query results are mapped from pg's format to Kysely's
 * `QueryResult` format.
 */
export class AsyncPgConnection implements DatabaseConnection {
    readonly [pgConnectionSymbol]: PgConnection;
    readonly #options: AsyncPgConnectionOptions;

    constructor(pgConnection: PgConnection, options: AsyncPgConnectionOptions = {}) {
        this[pgConnectionSymbol] = pgConnection;
        this.#options = options;
    }

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const result = await this[pgConnectionSymbol].query(
            compiledQuery.sql,
            [...compiledQuery.parameters] as any[],
        );

        if (result.command === 'INSERT' || result.command === 'UPDATE' || result.command === 'DELETE' || result.command === 'MERGE') {
            const numAffectedRows = result.rowCount !== null && result.rowCount !== undefined
                ? BigInt(result.rowCount)
                : undefined;

            return {
                numAffectedRows,
                rows: (result.rows ?? []) as R[],
            };
        }

        return {
            rows: (result.rows ?? []) as R[],
        };
    }

    async* streamQuery<R>(compiledQuery: CompiledQuery, chunkSize?: number): AsyncIterableIterator<QueryResult<R>> {
        if (!this.#options.cursor) {
            throw new Error(
                '\'cursor\' is not present in your async-pg-kysely config. '
                + 'It\'s required to make streaming work. '
                + 'Install pg-cursor and pass it to the provider options.',
            );
        }

        if (!Number.isInteger(chunkSize) || chunkSize! <= 0) {
            throw new Error('chunkSize must be a positive integer');
        }

        const cursor = this[pgConnectionSymbol].query(
            new this.#options.cursor(compiledQuery.sql, compiledQuery.parameters.slice()) as any,
        );

        try {
            while (true) {
                const rows = await cursor.read(chunkSize!);

                if (rows.length === 0) {
                    break;
                }

                yield {rows: rows as R[]};
            }
        } finally {
            await cursor.close();
        }
    }
}
