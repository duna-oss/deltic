import type {Knex} from 'knex';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {BufferedCall, Connection} from './types.js';

/**
 * Methods that start a query builder chain.
 */
const QUERY_BUILDER_METHODS = new Set([
    'select',
    'insert',
    'update',
    'delete',
    'del',
    'from',
    'into',
    'table',
    'with',
    'withRecursive',
    'first',
    'pluck',
    'count',
    'min',
    'max',
    'sum',
    'avg',
    'countDistinct',
    'sumDistinct',
    'avgDistinct',
    'distinct',
]);

/**
 * Creates a lazy Connection that defers actual database connection
 * acquisition until a query is awaited.
 */
export function createLazyConnection(knex: Knex, pool: AsyncPgPool): Connection {
    const handler: ProxyHandler<object> = {
        // Handle connection('tableName') syntax
        apply(_target, _thisArg, args: [string?]) {
            const tableName = args[0];
            return createLazyQueryBuilder(knex, pool, tableName);
        },

        get(_target, prop) {
            // For query builder methods, return a function that creates a lazy builder
            if (typeof prop === 'string' && QUERY_BUILDER_METHODS.has(prop)) {
                return (...args: unknown[]) => {
                    return createLazyQueryBuilder(knex, pool, undefined, [{method: prop, args}]);
                };
            }

            // For raw queries
            if (prop === 'raw') {
                return (sql: string, bindings?: Knex.RawBinding | Knex.RawBinding[]) => {
                    return createLazyRawBuilder(knex, pool, sql, bindings);
                };
            }

            // For non-query properties, delegate to knex
            return (knex as any)[prop];
        },
    };

    // Use a function as the proxy target so it's callable
    return new Proxy(function () {}, handler) as unknown as Connection;
}

/**
 * Creates a Proxy that buffers query builder method calls and only
 * executes when the promise is awaited (via .then()).
 */
export function createLazyQueryBuilder(
    knex: Knex,
    pool: AsyncPgPool,
    tableName?: string,
    initialCalls: BufferedCall[] = [],
): Knex.QueryBuilder {
    const bufferedCalls: BufferedCall[] = [...initialCalls];

    const handler: ProxyHandler<object> = {
        get(_target, prop, receiver) {
            // Handle thenable - called when awaited
            if (prop === 'then') {
                return (
                    onFulfilled?: (value: unknown) => unknown,
                    onRejected?: (reason: unknown) => unknown,
                ) => {
                    return executeQuery(knex, pool, tableName, bufferedCalls).then(onFulfilled, onRejected);
                };
            }

            if (prop === 'catch') {
                return (onRejected?: (reason: unknown) => unknown) => {
                    return executeQuery(knex, pool, tableName, bufferedCalls).catch(onRejected);
                };
            }

            if (prop === 'finally') {
                return (onFinally?: () => void) => {
                    return executeQuery(knex, pool, tableName, bufferedCalls).finally(onFinally);
                };
            }

            // toSQL() doesn't need a connection - can be called synchronously
            if (prop === 'toSQL') {
                return () => {
                    const builder = tableName ? knex(tableName) : knex.queryBuilder();
                    replayBufferedCalls(builder, bufferedCalls);
                    return builder.toSQL();
                };
            }

            // toString() for debugging
            if (prop === 'toString') {
                return () => {
                    const builder = tableName ? knex(tableName) : knex.queryBuilder();
                    replayBufferedCalls(builder, bufferedCalls);
                    return builder.toString();
                };
            }

            // clone() creates a new independent lazy query builder
            if (prop === 'clone') {
                return () => {
                    // Create a deep copy of buffered calls to ensure independence
                    return createLazyQueryBuilder(knex, pool, tableName, bufferedCalls.map(call => ({
                        ...call,
                        args: [...call.args],
                    })));
                };
            }

            // Buffer all other method calls and return proxy for chaining
            return (...args: unknown[]) => {
                bufferedCalls.push({method: prop, args});
                return receiver;
            };
        },
    };

    return new Proxy({}, handler) as unknown as Knex.QueryBuilder;
}

/**
 * Creates a Proxy for raw queries that defers execution until awaited.
 */
export function createLazyRawBuilder(
    knex: Knex,
    pool: AsyncPgPool,
    sql: string,
    bindings?: Knex.RawBinding | Knex.RawBinding[],
): Knex.Raw {
    const handler: ProxyHandler<object> = {
        get(_target, prop) {
            // Handle thenable
            if (prop === 'then') {
                return (
                    onFulfilled?: (value: unknown) => unknown,
                    onRejected?: (reason: unknown) => unknown,
                ) => {
                    return executeRawQuery(knex, pool, sql, bindings).then(onFulfilled, onRejected);
                };
            }

            if (prop === 'catch') {
                return (onRejected?: (reason: unknown) => unknown) => {
                    return executeRawQuery(knex, pool, sql, bindings).catch(onRejected);
                };
            }

            if (prop === 'finally') {
                return (onFinally?: () => void) => {
                    return executeRawQuery(knex, pool, sql, bindings).finally(onFinally);
                };
            }

            // toSQL() doesn't need a connection
            if (prop === 'toSQL') {
                return () => {
                    return knex.raw(sql, bindings as any).toSQL();
                };
            }

            // toString() for debugging
            if (prop === 'toString') {
                return () => {
                    return knex.raw(sql, bindings as any).toString();
                };
            }

            // Delegate other properties to the raw builder
            return (knex.raw(sql, bindings as any) as any)[prop];
        },
    };

    return new Proxy({}, handler) as unknown as Knex.Raw;
}

/**
 * Executes a buffered query by acquiring a connection, replaying calls, and executing.
 */
async function executeQuery(
    knex: Knex,
    pool: AsyncPgPool,
    tableName: string | undefined,
    bufferedCalls: BufferedCall[],
): Promise<unknown> {
    const connection = await pool.primary();
    const inTransaction = pool.inTransaction();

    try {
        // Build the query
        const builder = tableName ? knex(tableName) : knex.queryBuilder();

        // Replay buffered calls
        replayBufferedCalls(builder, bufferedCalls);

        // Bind to our connection and execute
        return await builder.connection(connection as any);
    } finally {
        // Release if not in transaction
        if (!inTransaction) {
            await pool.release(connection);
        }
    }
}

/**
 * Executes a raw query by acquiring a connection.
 */
async function executeRawQuery(
    knex: Knex,
    pool: AsyncPgPool,
    sql: string,
    bindings?: Knex.RawBinding | Knex.RawBinding[],
): Promise<unknown> {
    const connection = await pool.primary();
    const inTransaction = pool.inTransaction();

    try {
        return await knex.raw(sql, bindings as any).connection(connection as any);
    } finally {
        if (!inTransaction) {
            await pool.release(connection);
        }
    }
}

/**
 * Replays buffered method calls on a real query builder.
 */
function replayBufferedCalls(builder: Knex.QueryBuilder, calls: BufferedCall[]): void {
    for (const {method, args} of calls) {
        (builder as any)[method](...args);
    }
}
