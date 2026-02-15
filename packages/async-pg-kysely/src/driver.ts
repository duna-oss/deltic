import type {DatabaseConnection, Driver, TransactionSettings} from 'kysely';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import {AsyncPgConnection, pgConnectionSymbol} from './connection.js';
import {KyselyTransactionsNotSupported} from './errors.js';

/**
 * A Kysely Driver backed by AsyncPgPool.
 *
 * This driver implements Kysely's Driver interface, routing all connection
 * management through AsyncPgPool. Connections are acquired via
 * `pool.primary()` and released conditionally based on transaction state.
 *
 * The `beginTransaction`, `commitTransaction`, and `rollbackTransaction`
 * methods throw to prevent Kysely from issuing transaction commands that
 * would conflict with AsyncPgPool's transaction state. All transaction
 * lifecycle management must go through AsyncPgPool or the provider.
 */
export class AsyncPgDriver implements Driver {
    constructor(private readonly pool: AsyncPgPool) {}

    async init(): Promise<void> {
        // No-op — AsyncPgPool is already initialized.
    }

    async acquireConnection(): Promise<DatabaseConnection> {
        const pgConnection = await this.pool.primary();
        return new AsyncPgConnection(pgConnection);
    }

    async beginTransaction(_connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
        throw KyselyTransactionsNotSupported.because();
    }

    async commitTransaction(_connection: DatabaseConnection): Promise<void> {
        throw KyselyTransactionsNotSupported.because();
    }

    async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
        throw KyselyTransactionsNotSupported.because();
    }

    async releaseConnection(connection: DatabaseConnection): Promise<void> {
        if (!this.pool.inTransaction()) {
            await this.pool.release((connection as AsyncPgConnection)[pgConnectionSymbol]);
        }
    }

    async destroy(): Promise<void> {
        // No-op — AsyncPgPool lifecycle is managed externally.
    }
}
