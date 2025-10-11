import type {Pool, PoolClient} from 'pg';
import {StaticMutexUsingMemory} from '@deltic/mutex/static-memory';
import {AsyncLocalStorage} from 'node:async_hooks';
import {StaticMutex} from '@deltic/mutex';
import {errorToMessage, StandardError} from '@deltic/error-standard';
import {IncomingMessage, ServerResponse} from 'node:http';

export interface NextFunction {
    (err?: any): void;
}

interface HttpMiddleware {
    <Request extends IncomingMessage, Response extends ServerResponse, Next extends NextFunction>(
        req: Request,
        res: Response,
        next: Next,
    ): unknown;
}

const originalRelease = Symbol.for('@deltic/async-pg-pool/release');

export interface Connection extends Omit<PoolClient, 'release'> {
    [Symbol.asyncDispose]: () => Promise<void>;
}

export interface TransactionContext {
    exclusiveAccess: StaticMutex,
    sharedTransaction?: Connection | undefined,
    primaryConnection?: Connection | undefined,
    free: Array<[Connection, undefined | ReturnType<typeof setTimeout>]>,
}

export interface TransactionContextProvider {
    resolve(): TransactionContext;
    run?: <R>(callback: () => R) => R;
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
            primaryConnection: undefined,
            free: [],
        }, callback);
    }
}

export interface AsyncPgPoolOptions {
    keepConnections?: number,
    maxIdleMs?: number,
    onClaim?: (client: Connection) => Promise<any> | any,
    onRelease?: (client: Connection, err?: unknown) => Promise<any> | any,
    releaseHookOnError?: boolean,
    freshResetQuery?: string,
}

export class AsyncPgPool {
    private readonly keepConnections: number;
    private readonly maxIdleMs: number;
    private readonly freshResetQuery: string;

    constructor(
        private readonly pool: Pool,
        private readonly options: AsyncPgPoolOptions = {},
        private readonly context: TransactionContextProvider = new StaticPgTransactionContextProvider(),
    ) {
        this.keepConnections = options.keepConnections ?? 0;
        this.maxIdleMs = options.maxIdleMs ?? 1000;
        this.freshResetQuery = options.freshResetQuery ?? 'RESET ALL';
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

            return context.primaryConnection = await this.claim();
        } finally {
            await context.exclusiveAccess.unlock();
        }
    }

    httpMiddleware(): HttpMiddleware {
        const flush = this.flushSharedContext.bind(this);

        return async (_req, res, next) => {
            res.on('finish', flush);

            if (this.context.run === undefined) {
                next();
            } else {
                await this.context.run?.(async () => {
                    next();
                });
            }
        };
    }

    async flushSharedContext(): Promise<void> {
        const context = this.context.resolve();
        await context.exclusiveAccess.lock();

        try {
            await Promise.all(context.free.map(([connection, timeout]) => {
                clearTimeout(timeout);
                this.doRelease(connection);
            }));
            context.free.length = 0;

            if (context.primaryConnection) {
                await this.doRelease(context.primaryConnection);
                context.primaryConnection = undefined;
            }

            if (context.sharedTransaction) {
                throw new Error('Expected not the have a transaction, but one was found. Forgot to call commit or rollback?');
            }
        } finally {
            await context.exclusiveAccess.unlock();
        }
    }

    async claim(): Promise<Connection> {
        const context = this.context.resolve();
        const [freeClient, timeout] = context.free.shift() ?? [];

        if (freeClient) {
            clearTimeout(timeout);

            return freeClient;
        }

        return this.claimFromPool();
    }

    private async claimFromPool(): Promise<Connection> {
        const client = await this.pool.connect() as unknown as Connection;
        const onClaim = this.options.onClaim;

        if (onClaim) {
            try {
                await onClaim(client);
            } catch (err) {
                await this.doRelease(client, err);

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

    async claimFresh(): Promise<Connection> {
        const connection = await this.claimFromPool();

        try {
            await connection.query(this.freshResetQuery);

            return connection;
        } catch (err) {
            throw UnableToClaimConnection.because(err);
        }
    }

    async begin(query?: string): Promise<Connection> {
        const context = this.context.resolve();
        await context.exclusiveAccess.lock();


        if (context.sharedTransaction) {
            await context.exclusiveAccess.unlock();
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

    commit(client: Connection): Promise<void> {
        return this.finalizeTransaction('COMMIT', client);
    }

    rollback(client: Connection, error?: unknown): Promise<void> {
        return this.finalizeTransaction('ROLLBACK', client, error);
    }

    private async finalizeTransaction(command: 'ROLLBACK' | 'COMMIT', client: Connection, error?: unknown): Promise<void> {
        const context = this.context.resolve();

        if (context.sharedTransaction !== client) {
            throw new Error(`Trying to ${command} a transaction that is NOT the known transaction.`);
        }

        try {
            await client.query(command);
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

        if (err === undefined && this.keepConnections > context.free.length) {
            const timeout = this.maxIdleMs === undefined
                ? undefined
                : setTimeout(() => {
                    const context = this.context.resolve();
                    const index = context.free.findIndex(([c]) => c === connection);

                    if (index >= 0) {
                        context.free.splice(index, 1);
                    }
                }, this.maxIdleMs);
            context.free.push([connection, timeout]);
        } else {
            return this.doRelease(connection, err);
        }
    }

    private async doRelease(connection: Connection, err: unknown = undefined): Promise<void> {
        const onRelease = this.options.onRelease;

        if (onRelease && (err === undefined || this.options.releaseHookOnError)) {
            try {
                await onRelease(connection, err);
            } catch (onReleaseError) {
                ((connection as any)[originalRelease] as PoolClient['release'])(
                    onReleaseError instanceof Error
                        ? onReleaseError
                        : new Error(String(onReleaseError))
                );

                throw UnableToReleaseConnection.because(onReleaseError);
            }
        }

        ((connection as any)[originalRelease] as PoolClient['release'])(
            err === undefined
                ? err
                : err instanceof Error
                    ? err
                    : new Error(String(err)),
        );
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

