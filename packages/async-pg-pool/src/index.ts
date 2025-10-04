import type {Pool, PoolClient} from 'pg';
import {StaticMutexUsingMemory} from '@deltic/mutex/static-memory-mutex';
import {AsyncLocalStorage} from 'node:async_hooks';
import {StaticMutex} from '@deltic/mutex';
import {errorToMessage, StandardError} from '@deltic/error-standard';

const originalRelease = Symbol.for('@deltic/async-pg-pool/release');

export interface Connection extends Omit<PoolClient, 'release'> {
    [Symbol.asyncDispose]: () => Promise<void>;
    [originalRelease]: PoolClient['release'];
}

export interface TransactionContext {
    exclusiveAccess: StaticMutex,
    sharedTransaction?: Connection | undefined,
    primaryConnection?: Connection | undefined,
    free: Array<Connection>,
}

export interface TransactionContextProvider {
    resolve(): TransactionContext;
}

export class StaticPgTransactionContextProvider implements TransactionContextProvider {
    private context: TransactionContext = {
        exclusiveAccess: new StaticMutexUsingMemory(),
        sharedTransaction: undefined,
        primaryConnection: undefined,
        free: [],
    };

    resolve(): TransactionContext {
        return this.context;
    }
}

export class AsyncPgTransactionContextProvider implements TransactionContextProvider {
    constructor(
        private readonly store: AsyncLocalStorage<TransactionContext> = new AsyncLocalStorage<TransactionContext>(),
    ) {
    }

    resolve(): TransactionContext {
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
            free: [],
        }, callback);
    }
}

export interface AsyncPgPoolOptions {
    keepConnections?: number
    onClaim?: (client: Connection) => Promise<any> | any,
    onRelease?: (client: Connection, err?: unknown) => Promise<any> | any,
    releaseHookOnError?: boolean,
}

export class AsyncPgPool {
    private readonly keepConnections: number;

    constructor(
        private readonly pool: Pool,
        private readonly options: AsyncPgPoolOptions,
        private readonly context: TransactionContextProvider = new StaticPgTransactionContextProvider(),
    ) {
        this.keepConnections = options.keepConnections ?? 0;
    }

    async primary(): Promise<Connection> {
        const context = this.context.resolve();
        await context.exclusiveAccess.lock();

        try {
            const transaction = context.sharedTransaction;

            if (transaction) {
                return transaction;
            }

            const primaryConnection = context.primaryConnection;

            if (primaryConnection) {
                return primaryConnection;
            }

            const connection = context.free.shift()
                ?? await this.claim();

            return context.primaryConnection = connection;
        } finally {
            await context.exclusiveAccess.unlock();
        }
    }

    async flushSharedContext(): Promise<void> {
        const context = this.context.resolve();

        await Promise.all(context.free.map(this.doRelease));

        if (context.primaryConnection) {
            await this.doRelease(context.primaryConnection);
        }

        if (context.sharedTransaction) {
            throw new Error('Expected not the have a transaction, but one was found. Forgot to call commit or rollback?');
        }
    }

    async claim(): Promise<Connection> {
        const  client = await this.pool.connect() as unknown as Connection;
        const onClaim = this.options.onClaim;

        if (onClaim) {
            try {
                await onClaim(client);
            } catch (err) {
                await this.release(client, err);

                throw UnableToClaimConnection.because(err);
            }
        }

        const release = this.release.bind(this);
        const poolRelease = (client as unknown as PoolClient).release.bind(client);
        let released = false;

        return Object.defineProperties(client, {
            [originalRelease]: {
                writable: true,
                value: poolRelease,
            },
            [Symbol.asyncDispose]: {
                writable: true,
                value: async () => {
                    if (!released) {
                        released = true;
                        return release(client);
                    }
                },
            },
            release: {
                writable: true,
                value: () => {
                    throw new Error('You should not release the client manually.');
                },
            },
        });
    }

    async begin(query?: string): Promise<Connection> {
        const context = this.context.resolve();
        await context.exclusiveAccess.lock();

        if (context.sharedTransaction) {
            throw new Error('Cannot begin transaction when already inside one');
        }

        let client: Connection;

        try {
            client = context.primaryConnection ?? await this.claim();
        } catch (e) {
            await context.exclusiveAccess.unlock();
            throw e;
        }

        try {
            await client.query(query ?? 'BEGIN');

            return context.sharedTransaction = client;
        } catch (e) {
            await this.doRelease(client, e);
            throw e;
        } finally {
            await context.exclusiveAccess.unlock();
        }
    }

    async commit(client: Connection): Promise<void> {
        try {
            await client.query('COMMIT');
            await this.release(client);
        } catch (e) {
            await this.doRelease(client, e);
            throw e;
        } finally {
            this.context.resolve().sharedTransaction = undefined;
        }
    }

    async rollback(client: Connection, error?: unknown): Promise<void> {
        try {
            await client.query('ROLLBACK');
            await this.release(client, error);
        } catch (e) {
            await this.doRelease(client, e);
            throw e;
        } finally {
            this.context.resolve().sharedTransaction = undefined;
        }
    }

    async release(connection: Connection, err: unknown = undefined): Promise<void> {
        const context = this.context.resolve();

        if (connection === context.primaryConnection) {
            return;
        }

        if (err === undefined && this.keepConnections < context.free.length) {
            context.free.push(connection);
        } else {
            return this.doRelease(connection, err);
        }
    }

    private async doRelease(connection: Connection, err: unknown = undefined): Promise<void> {
        const onRelease = this.options.onRelease;
        let error: unknown | undefined = err;
        let throwError: boolean = false;

        if (onRelease && (error === undefined || this.options.releaseHookOnError)) {
            try {
                await onRelease(connection, err);
            } catch (onReleaseError) {
                throwError = true;
                error = onReleaseError;
            }
        }

        connection[originalRelease](
            error === undefined
                ? error
                : error instanceof Error
                    ? error
                    : new Error(String(error)),
        );

        if (throwError) {
            throw UnableToReleaseConnection.because(error);
        }
    }
}

class UnableToClaimConnection extends StandardError {
    static because = (err: unknown) => new UnableToClaimConnection(
        `Unable to claim connection: ${errorToMessage(err)}`,
        'async-pg-pool.unable_to_claim_connection',
        {},
        err,
    );
}

class UnableToReleaseConnection extends StandardError {
    static because = (err: unknown) => new UnableToReleaseConnection(
        `Unable to release connection: ${errorToMessage(err)}`,
        'async-pg-pool.unable_to_release_connection',
        {},
        err,
    );
}

