import {defineConfig} from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import {join} from 'node:path';


export default defineConfig({
    plugins: [tsconfigPaths()],
    resolve: {
        alias: [
            {
                find: '@deltic/mutex/static-memory',
                replacement: join(new URL(import.meta.url).pathname, '../packages/mutex/src/static-memory.ts'),
            },
            {
                find: /^@\/(.*)$/,
                replacement: join(new URL(import.meta.url).pathname, '../packages', '$1', 'src/index.ts'),
            },
        ],
    },
    test: {
        testTimeout: 10_000,
        include: ['packages/*/src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
        globals: true,
        clearMocks: false,
        env: {
            POSTGRES_PORT: process.env.POSTGRES_PORT ?? '35432',
        },
        // setupFiles: ['dotenv/config'],

        // pool: 'threads',
        isolate: false,
        // profiling
        // pool: 'forks',
        // poolOptions: {
        //     forks: {
        //         execArgv: [
        //             '--cpu-prof',
        //             '--cpu-prof-dir=test-runner-profile',
        //             // '--heap-prof',
        //             // '--heap-prof-dir=test-runner-profile'
        //         ],
        //
        //         // To generate a single profile
        //         singleFork: true,
        //     },
        // },
    },
});