import {
    type Dialect,
    type Driver,
    type Kysely,
    type DatabaseIntrospector,
    type DialectAdapter,
    type QueryCompiler,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import {AsyncPgDriver} from './driver.js';

/**
 * A Kysely Dialect that uses AsyncPgPool for connection management.
 *
 * This dialect reuses Kysely's built-in PostgresQueryCompiler,
 * PostgresAdapter, and PostgresIntrospector while providing a custom
 * driver backed by AsyncPgPool.
 */
export class AsyncPgDialect implements Dialect {
    constructor(private readonly pool: AsyncPgPool) {}

    createDriver(): Driver {
        return new AsyncPgDriver(this.pool);
    }

    createQueryCompiler(): QueryCompiler {
        return new PostgresQueryCompiler();
    }

    createAdapter(): DialectAdapter {
        return new PostgresAdapter();
    }

    createIntrospector(db: Kysely<any>): DatabaseIntrospector {
        return new PostgresIntrospector(db);
    }
}
