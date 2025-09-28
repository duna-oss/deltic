import type {Pool, PoolClient} from 'pg';
import {StaticMutexUsingMemory} from '@deltic/mutex/static-memory-mutex';
import {AsyncLocalStorage} from 'node:async_hooks';
import {StaticMutex} from '@deltic/mutex';
import {errorToMessage, StandardError} from '@deltic/error-standard';

export type Connection = PoolClient & {
    [Symbol.asyncDispose]: () => Promise<void>
};

/**
 * Connection providers facilitate the sharing of transactions between infrastructural layers. The
 * primary benefit is that it makes code more composable, without making your domain APIs database
 * aware. This is achieved by (optionally) storing a connection, and using it as the connection for
 * interactions that are coupled through composition. Doing so makes infrastructural coupling work
 * with and without a database transaction.
 */
export interface PgConnectionProvider {
    claim(): Promise<PoolClient>;

    release(client: PoolClient): Promise<void>;

    begin(query?: string): Promise<PoolClient>;

    commit(client: PoolClient): Promise<void>;

    rollback(client: PoolClient, error: unknown): Promise<void>;
}

export interface PgTransactionContext {
    exclusiveAccess: StaticMutex,
    sharedTransaction?: Connection | undefined,
}

export interface PgTransactionContextProvider {
    resolve(): PgTransactionContext;
}

export class StaticPgTransactionContextProvider implements PgTransactionContextProvider {
    private exclusiveAccess = new StaticMutexUsingMemory();
    private sharedTransaction: Connection | undefined;

    resolve(): PgTransactionContext {
        return {
            exclusiveAccess: this.exclusiveAccess,
            sharedTransaction: this.sharedTransaction,
        };
    }
}

export class AsyncPgTransactionContextProvider implements PgTransactionContextProvider {
    constructor(
        private readonly store: AsyncLocalStorage<PgTransactionContext> = new AsyncLocalStorage<PgTransactionContext>(),
    ) {
    }

    resolve(): PgTransactionContext {
        const context = this.store.getStore();

        if (!context) {
            throw new Error('No transaction context set, did you forget a .run call?');
        }

        return context;
    }

    run<R>(callback: () => R): R {
        return this.store.run({
            exclusiveAccess: new StaticMutexUsingMemory(),
            sharedTransaction: undefined,
        }, callback);
    }
}

export interface PgConnectionPoolOptions {
    shareTransactions: boolean,
    afterClaim?: (client: PoolClient) => Promise<any> | any,
    beforeRelease?: (client: PoolClient, err?: unknown) => Promise<any> | any,
}

export class PgConnectionProviderWithPool implements PgConnectionProvider {
    constructor(
        private readonly pool: Pool,
        private readonly options: PgConnectionPoolOptions = {shareTransactions: true},
        private readonly context: PgTransactionContextProvider = new StaticPgTransactionContextProvider(),
    ) {
    }

    async claim(): Promise<Connection> {
        const client = await this.pool.connect();
        const afterClaim = this.options.afterClaim;

        if (afterClaim) {
            try {
                await afterClaim(client);
            } catch (err) {
                await this.release(client, err);

                throw UnableToClaimConnection.because(err);
            }
        }

        return Object.defineProperty(client, Symbol.asyncDispose, {
            value: () => this.release(client),
            writable: true,
        }) as Connection;
    }

    async begin(query?: string): Promise<PoolClient> {
        if (!this.options.shareTransactions) {
            const client = await this.claim();

            try {
                await client.query(query ?? 'BEGIN');

                return client;
            } catch (e) {
                await this.release(client);

                throw e;
            }
        }

        const context = this.context.resolve();
        await context.exclusiveAccess.lock();

        try {
            const client = await this.claim();

            await client.query(query ?? 'BEGIN');

            if (this.options.shareTransactions) {
                context.sharedTransaction = client;
            }

            return client;
        } finally {
            await context.exclusiveAccess.unlock();
        }
    }

    async commit(client: PoolClient): Promise<void> {
        try {
            await client.query('COMMIT');
        } finally {
            await this.release(client);
            this.context.resolve().sharedTransaction = undefined;
        }
    }

    async rollback(client: PoolClient, error: unknown): Promise<void> {
        try {
            await client.query('ROLLBACK');
        } finally {
            await this.release(client, error);
            this.context.resolve().sharedTransaction = undefined;
        }
    }

    async release(client: PoolClient, err: unknown = undefined): Promise<void> {
        const beforeRelease = this.options.beforeRelease;
        let error: unknown | undefined = undefined;

        if (beforeRelease) {
            try {
                await beforeRelease(client, err);
            } catch (beforeReleaseError) {
                error = beforeReleaseError;
                err = beforeReleaseError;
            }
        }

        client.release(
            err === undefined
                ? err
                : err instanceof Error
                    ? err
                    : new Error(String(err)),
        );

        if (error) {
            throw UnableToReleaseConnection.because(error);
        }
    }
}

class UnableToClaimConnection extends StandardError {
    static because = (err: unknown) => new UnableToClaimConnection(
        `Unable to claim connection: ${errorToMessage(err)}`,
        'pg-connection-provider.unable_to_claim_connection',
        {},
        err,
    );
}

class UnableToReleaseConnection extends StandardError {
    static because = (err: unknown) => new UnableToReleaseConnection(
        `Unable to release connection: ${errorToMessage(err)}`,
        'pg-connection-provider.unable_to_release_connection',
        {},
        err,
    );
}

