import {type DynamicMutex, type LockValue, UnableToAcquireLock, UnableToReleaseLock} from '@deltic/mutex';
import {AsyncPgPool, type Connection} from '@deltic/async-pg-pool';
import {AsyncLocalStorage} from 'node:async_hooks';
import {MultiMutex} from '@deltic/mutex/multi';
import {MutexUsingMemory} from '@deltic/mutex/memory';

export type PostgresMutexMode = 'fresh' | 'primary';

export interface ConnectionStorage {
    connections: Map<number, Connection>,
}

export interface ConnectionStorageProvider {
    resolve(): ConnectionStorage
}

export class StaticConnectionStorageProvider implements ConnectionStorageProvider {
    private readonly context: ConnectionStorage = {
        connections: new Map(),
    };

    resolve(): ConnectionStorage {
        return this.context;
    }
}

export class AsyncConnectionStorageProvider implements ConnectionStorageProvider {
    constructor(
        private readonly store = new AsyncLocalStorage<ConnectionStorage>(),
    ) {
    }

    resolve(): ConnectionStorage {
        const context = this.store.getStore();

        if (!context) {
            throw new Error('No connection context set, did you forget a .run call?');
        }

        return context;
    }

    run<R>(callback: () => R): R {
        return this.store.run({
            connections: new Map(),
        }, callback);
    }
}

export class MutexUsingPostgres<LockID extends LockValue> implements DynamicMutex<LockID> {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly idConverter: LockIdConverter<LockID>,
        private readonly mode: PostgresMutexMode,
        private readonly connectionStorage: ConnectionStorageProvider = new StaticConnectionStorageProvider(),
    ) {
    }

    private connection(): Promise<Connection> {
        if (this.mode === 'fresh') {
            return this.pool.claimFresh();
        } else if (this.mode === 'primary') {
            return this.pool.primary();
        }

        throw new Error(`Unknown postgres mutex mode provided: ${this.mode}`);
    }

    async lock(id: LockID, timeout: number): Promise<void> {
        const client = await this.connection();
        const lockId = this.idConverter.convert(id);

        try {
            await client.query(`SET SESSION lock_timeout TO '${timeout}ms'`);
            await client.query('SELECT pg_advisory_lock($1) as locked', [lockId]);
            this.connections.set(lockId, client);
            await client.query('RESET lock_timeout');
        } catch (e) {
            await this.pool.release(client, e);
            throw UnableToAcquireLock.becauseOfError(id, e);
        }
    }

    async tryLock(id: LockID): Promise<boolean> {
        const client = await this.connection();
        const lockId = this.idConverter.convert(id);

        try {
            const response = await client.query<{locked: boolean}>('select pg_try_advisory_lock($1) as locked', [lockId]);
            const wasLocked = response.rows[0].locked;

            if (wasLocked) {
                this.connections.set(lockId, client);
            } else {
                await this.pool.release(client);
            }

            return wasLocked;
        } catch (e) {
            await this.pool.release(client, e);

            throw UnableToAcquireLock.becauseOfError(id, e);
        }
    }

    private get connections(): Map<number, Connection> {
        return this.connectionStorage.resolve().connections;
    }

    async unlock(id: LockID): Promise<void> {
        const lockId = this.idConverter.convert(id);
        const connection = this.connections.get(lockId);

        if (!connection) {
            throw UnableToReleaseLock.becauseOfError(id, new Error('Connection was not available in storage.'));
        }

        try {
            const response = await connection.query('select pg_advisory_unlock($1)', [lockId]);
            await this.pool.release(connection);

            if (response.rows[0].pg_advisory_unlock === false) {
                throw UnableToReleaseLock.becauseOfError(id, new Error('Database told us it could not release the lock.'));
            }
        } catch (e) {
            await this.pool.release(connection, e);

            if (e instanceof UnableToReleaseLock) {
                throw e;
            }

            throw UnableToReleaseLock.becauseOfError(id, e);
        }
    }
}

export interface LockIdConverter<LockID> {
    convert(id: LockID): number,
}

export type LockRange = {
    base: number,
    range: number,
};

export function makePostgresMutex<
    const LockID extends string | number,
>(
    options: {
        pool: AsyncPgPool,
        converter: LockIdConverter<LockID>,
        mode?: PostgresMutexMode,
        connectionStorage?: ConnectionStorageProvider,
    }
): DynamicMutex<LockID> {
    const mode: PostgresMutexMode = options.mode ?? 'fresh';

    const primaryMutex = new MutexUsingPostgres(
        options.pool,
        options.converter,
        options.mode ?? 'fresh',
        options.connectionStorage,
    );

    if (mode === 'fresh') {
        return primaryMutex;
    }

    return new MultiMutex([
        new MutexUsingMemory(),
        primaryMutex,
    ]);
}