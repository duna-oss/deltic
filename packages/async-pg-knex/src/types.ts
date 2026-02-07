import type {Knex} from 'knex';
import type {Client} from 'pg';

/**
 * Buffered method call for replay on the real query builder.
 */
export interface BufferedCall {
    method: string | symbol;
    args: unknown[];
}

/**
 * Constructor type for callable Knex objects: knex('tableName')
 */
type KnexCallable<T> = (tableName?: string) => T;

/**
 * A Connection is a Knex-like object that can build queries,
 * but without transaction control methods (those are managed externally).
 */
export type Connection = Omit<Knex, 'transaction' | 'transactionProvider'> &
    KnexCallable<Omit<Knex.QueryBuilder, 'transaction' | 'transactionProvider'>>;

/**
 * A Transaction is similar to Connection but represents an active transaction.
 * Commit/rollback are omitted since they're handled by ConnectionProvider.
 */
export type Transaction = Omit<Knex.Transaction, 'savepoint' | 'commit' | 'rollback'> &
    KnexCallable<Omit<Knex.QueryBuilder, 'savepoint' | 'commit' | 'rollback'>>;

/**
 * Interface for connection providers that manage database connections
 * and transactions using Knex query builders.
 */
export interface ConnectionProvider {
    /**
     * Claim a raw pg Client from the pool.
     */
    claimClient(): Promise<Client>;

    /**
     * Release a raw pg Client back to the pool.
     */
    releaseClient(client: Client): Promise<void>;

    /**
     * Get a Connection for building queries.
     * The connection is lazy - no actual database connection is acquired
     * until the query is awaited.
     */
    connection(): Connection;

    /**
     * Begin a transaction and return a Transaction object.
     * @param beginQuery Optional custom BEGIN query (e.g., 'BEGIN ISOLATION LEVEL SERIALIZABLE')
     */
    begin(beginQuery?: string): Promise<Transaction>;

    /**
     * Get the current transaction. Throws if not in a transaction.
     */
    withTransaction(): Transaction;

    /**
     * Check if currently inside a transaction.
     */
    inTransaction(): boolean;

    /**
     * Commit a transaction.
     */
    commit(trx: Transaction): Promise<void>;

    /**
     * Rollback a transaction.
     */
    rollback(trx: Transaction): Promise<void>;
}
