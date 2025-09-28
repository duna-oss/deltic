import {Pool} from 'pg';
import {
    AsyncPgTransactionContextProvider,
    PgConnectionProvider,
    PgConnectionProviderWithPool,
    PgTransactionContext,
} from './index.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {StaticMutexUsingMemory} from '@deltic/mutex/static-memory-mutex';

const asyncLocalStorage = new AsyncLocalStorage<PgTransactionContext>();

const setupContext = () => asyncLocalStorage.enterWith({exclusiveAccess: new StaticMutexUsingMemory()});

describe('PgConnectionProvider', () => {
    let pool: Pool;
    let provider: PgConnectionProvider;
    const factoryWithStaticPool = () => new PgConnectionProviderWithPool(pool);
    const factoryWithAsyncPool = () => {
        return new PgConnectionProviderWithPool(
            pool,
            {shareTransactions: true},
            new AsyncPgTransactionContextProvider(
                asyncLocalStorage,
            ),
        );
    };

    beforeAll(async () => {
        pool = new Pool({
            host: 'localhost',
            user: 'duna',
            password: 'duna',
            port: Number(process.env.POSTGRES_PORT ?? 35432),
            max: 50,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
            maxLifetimeSeconds: 60,
        });
    });

    afterAll(async () => {
        await pool.end();
    });

    describe.each([
        ['pool, static transaction context', factoryWithStaticPool],
        ['pool, async transaction context', factoryWithAsyncPool],
    ] as const)('basics for %s', (_name, factory) => {
        beforeEach(() => {
            provider = factory();
        });

        test('smoketest, claiming a client', async () => {
            setupContext();

            const client = await provider.claim();

            try {
                const result = await client.query('SELECT 1 as num');
                expect(result.rowCount).toEqual(1);
                expect(result.rows[0].num).toEqual(1);
            } finally {
                await provider.release(client);
            }
        });

        test('smoketest, using a plain transaction', async () => {
            setupContext();

            const client = await provider.begin();

            try {
                const result = await client.query('SELECT 1 as num');
                expect(result.rowCount).toEqual(1);
                expect(result.rows[0].num).toEqual(1);
            } finally {
                await provider.commit(client);
            }
        });
    });

    describe.each([
        ['pool', factoryWithStaticPool],
    ] as const)('transactional behaviour using %s', (name, factory) => {
        const tableName = `transactions_test_for_${name.toLowerCase().replace(/ /g, '_')}`;

        beforeAll(async () => {
            provider = factory();
            await pool.query(`
                CREATE TABLE ${tableName} (
                    identifier TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    age INTEGER
                );
            `);
        });

        test('beginning and committing a transaction', async () => {
            setupContext();

            const connection = await provider.begin();

            await provider.commit(connection);
        });

        afterAll(async () => {
            await pool.query(`DROP TABLE ${tableName}`);
        });
    });
});