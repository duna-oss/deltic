import {type Service, ServiceDispatcher, type ServiceHandlers} from '@deltic/service-dispatcher';
import {createServiceLockingMiddleware} from './locking-middleware.js';
import {MutexUsingMemory} from '@deltic/mutex/memory';
import {ServiceLocking} from './locking-decorator.js';
import type {ServiceLockingOptions} from './shared-for-locking.js';
import {setTimeout as wait} from 'timers/promises';

interface ExampleService {
    ping: {
        payload: {
            id: string;
            returnThis: string;
        };
        response: {
            value: string;
        };
    };
    pong: {
        payload: {
            id: string;
            returnWhat: string;
        };
        response: {
            returned: string;
        };
    };
    excluded: {
        payload: {
            id: string;
            value: string;
        };
        response: string;
    };
}

describe.each([
    [
        'middleware',
        (handlers: ServiceHandlers<ExampleService>, options: ServiceLockingOptions<ExampleService, string>) =>
            new ServiceDispatcher(handlers, [createServiceLockingMiddleware(options)]),
    ],
    [
        'decorator',
        (handlers: ServiceHandlers<ExampleService>, options: ServiceLockingOptions<ExampleService, string>) =>
            new ServiceLocking(new ServiceDispatcher(handlers), options),
    ],
] as const)('@deltic/service-locking using %s', (_name, factory) => {
    let service: Service<ExampleService>;
    let segments: string[];

    beforeEach(() => {
        segments = [];
        service = factory(
            {
                ping: async payload => {
                    segments.push(payload.returnThis);
                    await wait(5);
                    segments.push(payload.returnThis);

                    return {
                        value: payload.returnThis,
                    };
                },
                pong: async payload => {
                    segments.push(payload.returnWhat);
                    await wait(5);
                    segments.push(payload.returnWhat);

                    return {
                        returned: payload.returnWhat,
                    };
                },
                excluded: async payload => {
                    segments.push(payload.value);
                    await wait(5);
                    segments.push(payload.value);

                    return payload.value;
                },
            },
            {
                mutex: new MutexUsingMemory<string>(),
                lockResolver: input => input.payload.id,
                shouldSkip: input => input.type === 'excluded',
            },
        );
    });

    test('dispatching two different commands at the same time for the same lock', async () => {
        await Promise.all([
            service.handle('ping', {
                id: 'one',
                returnThis: 'first',
            }),
            service.handle('pong', {
                id: 'one',
                returnWhat: 'second',
            }),
        ]);

        expect(segments).toEqual(['first', 'first', 'second', 'second']);
    });

    test('dispatching two different commands at the same time for a different lock', async () => {
        await Promise.all([
            service.handle('ping', {
                id: 'two',
                returnThis: 'first',
            }),
            service.handle('pong', {
                id: 'three',
                returnWhat: 'second',
            }),
        ]);

        expect(segments).toEqual(['first', 'second', 'first', 'second']);
    });

    test('dispatching concurrently on the same lock, but locking is skipped', async () => {
        await Promise.all([
            service.handle('excluded', {
                id: 'two',
                value: 'first',
            }),
            service.handle('pong', {
                id: 'three',
                returnWhat: 'second',
            }),
        ]);

        expect(segments).toEqual(['first', 'second', 'first', 'second']);
    });
});
