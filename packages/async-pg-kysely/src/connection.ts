import type {DatabaseConnection, QueryResult} from 'kysely';
import type {CompiledQuery} from 'kysely';
import type {Connection as PgConnection} from '@deltic/async-pg-pool';

/**
 * Symbol used to access the underlying pg connection from an AsyncPgConnection.
 */
export const pgConnectionSymbol = Symbol.for('@deltic/async-pg-kysely/connection');

/**
 * A Kysely DatabaseConnection that wraps a pg connection from AsyncPgPool.
 *
 * This implements the minimal interface Kysely requires: `executeQuery` and
 * `streamQuery`. Query results are mapped from pg's format to Kysely's
 * `QueryResult` format.
 */
export class AsyncPgConnection implements DatabaseConnection {
    readonly [pgConnectionSymbol]: PgConnection;

    constructor(pgConnection: PgConnection) {
        this[pgConnectionSymbol] = pgConnection;
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

    async *streamQuery<R>(_compiledQuery: CompiledQuery, _chunkSize?: number): AsyncIterableIterator<QueryResult<R>> {
        throw new Error('Streaming queries are not supported by AsyncPgConnection');
    }
}
