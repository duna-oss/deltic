import {
    type Dialect,
    type Driver,
    type Kysely,
    type DatabaseIntrospector,
    type DialectAdapter,
    type QueryCompiler,
    type PostgresCursorConstructor,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import {AsyncPgDriver} from './driver.js';

/**
 * Options for creating an AsyncPgDialect.
 */
export interface AsyncPgDialectOptions {
    /**
     * A pg-cursor constructor, passed through to the driver
     * for streaming query support.
     */
    cursor?: PostgresCursorConstructor;
}

/**
 * A Kysely Dialect that uses AsyncPgPool for connection management.
 *
 * This dialect reuses Kysely's built-in PostgresQueryCompiler,
 * PostgresAdapter, and PostgresIntrospector while providing a custom
 * driver backed by AsyncPgPool.
 */
export class AsyncPgDialect implements Dialect {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly options: AsyncPgDialectOptions = {},
    ) {}

    createDriver(): Driver {
        return new AsyncPgDriver(this.pool, {cursor: this.options.cursor});
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
