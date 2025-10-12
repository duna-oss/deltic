import {DependencyContainer, reflectMethods} from './index.js';
import {isProxy} from 'node:util/types';
import {setTimeout as wait} from 'node:timers/promises';

describe('@deltic/dependency-injection', () => {
    let container: DependencyContainer;

    beforeEach(() => container = new DependencyContainer());

    describe('lazy dependencies', () => {
        let segments: string[];

        beforeEach(() => {
            segments = [];
            container.register('something', {
                lazy: true,
                factory: () => {
                    segments.push('during');
                    return new Dependency('something');
                },
            });
        });

        test('can be resolved', () => {
            segments.push('before');
            const something = container.resolve<Dependency>('something');
            segments.push('resolved');
            expect(something.name).toEqual('something');
            segments.push('after');
            expect(segments.join('-')).toEqual('before-resolved-during-after');
        });

        test('the next resolve is the actual instance', () => {
            let something = container.resolve<Dependency>('something');
            expect(something).toBeInstanceOf(Dependency);
            expect(isProxy(something)).toEqual(true);
            something = container.resolve<Dependency>('something');
            expect(something).toBeInstanceOf(Dependency);
            expect(isProxy(something)).toEqual(false);
        });

        // test('when not caching, you will always get a proxy', )
    });

    /**
     * Cleanups are a tad primitive right now, it sequentially executes the cleanup callbacks in
     * reverse order of resolving. This is to ensure each instance can shut down whilst their
     * dependencies have not yet shut down, ensuring their shutdown has functional dependencies.
     *
     * At a later point in time, a more sophisticated shutdown routine may be used.
     */
    describe('cleanups - one service depending on another', () => {
        let segments: string[];

        beforeEach(() => {
            segments = [];
            container.register('outer', {

                factory: container => ({
                    dependency: container.resolve('inner'),
                }),
                shutdown: async () => {
                    segments.push('outer');
                },
            });

            container.register('inner', {
                factory: () => ({
                    lol: 'what',
                }),
                shutdown: async () => {
                    segments.push('inner');
                },
            });
        });

        test('shutdowns are not triggered when the instances are not resolved', async () => {
            await container.shutdown();

            expect(segments).toHaveLength(0);
        });

        test('when one service is resolved, one shutdown happens', async () => {
            container.resolve('inner');

            await container.shutdown();

            expect(segments).toHaveLength(1);
            expect(segments[0]).toEqual('inner');
        });

        test('when two service is resolved, shutdown happens in order', async () => {
            container.resolve('outer');

            await container.shutdown();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });

        test('when two service is explicitly resolved, shutdown happens in order', async () => {
            container.resolve('outer');
            container.resolve('inner');

            await container.shutdown();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });

        test('when two service is explicitly resolved in reversed, shutdown still happens in order', async () => {
            container.resolve('inner');
            container.resolve('outer');

            await container.shutdown();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });
    });

    describe('complex cleanups are concurrent', () => {
        const segments: string[] = [];

        beforeEach(() => {
            segments.length = 0;

            container.register('inner', {
                factory: () => new Dependency('inner'),
                shutdown: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });

            container.register('middle-normal', {
                factory: c => {
                    return new Middle('middle-normal', c.resolve<Dependency>('inner'));
                },
            });

            container.register<Middle>('middle-lazy', {
                lazy: true,
                factory: c => {
                    return new Middle('middle-lazy', c.resolve<Dependency>('inner'));
                },
            });

            container.register<Outer>('outer-normal', {
                factory: c => {
                    const middle = c.resolve<Middle>('middle-normal');
                    return new Outer('outer-normal', middle);
                },
                shutdown: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });

            container.register<Outer>('outer-lazy', {
                factory: c => {
                    const middle = c.resolve<Middle>('middle-lazy');
                    return new Outer('outer-lazy', middle);
                },
                lazy: true,
                shutdown: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });
        });

        test('resolving outer normal', async () => {
            const outerNormal = container.resolve<Outer>('outer-normal');

            expect(outerNormal.name).toEqual('outer-normal');
            expect(outerNormal.middle.name).toEqual('middle-normal');
            expect(outerNormal.middle.inner.name).toEqual('inner');

            await container.shutdown();

            expect(segments).toEqual([
                'outer-normal',
                'outer-normal',
                'inner',
                'inner',
            ]);
        });

        test('resolving outer lazy', async () => {
            const outerLazy = container.resolve<Outer>('outer-lazy');

            expect(outerLazy.name).toEqual('outer-lazy');
            expect(outerLazy.middle.name).toEqual('middle-lazy');
            expect(outerLazy.middle.inner.name).toEqual('inner');

            await container.shutdown();

            expect(segments).toEqual([
                'outer-lazy',
                'outer-lazy',
                'inner',
                'inner',
            ]);
        });

        test('resolving and use both (and trigger lazy proxy)', async () => {
            container.resolve<Outer>('outer-normal');
            const lazy = container.resolve<Outer>('outer-lazy');

            expect(lazy.name).toEqual('outer-lazy');

            await container.shutdown();

            expect(segments).toEqual([
                'outer-normal',
                'outer-lazy',
                'outer-normal',
                'outer-lazy',
                'inner',
                'inner',
            ]);
        });

        test('cleanups are no invoked for lazy services that are not used', async () => {
            container.resolve<Outer>('outer-lazy');

            await container.shutdown();

            expect(segments).toEqual([]);
        });
    });

    test('ensure all proxy calls are handled', () => {
        const allReflectMethods = {
            apply: true,
            construct: true,
            defineProperty: true,
            deleteProperty: true,
            get: true,
            getOwnPropertyDescriptor: true,
            getPrototypeOf: true,
            has: true,
            isExtensible: true,
            ownKeys: true,
            preventExtensions: true,
            set: true,
            setPrototypeOf: true,
        } as const satisfies {
            [K in keyof Required<ProxyHandler<any>>]: true
        };

        const expected = Object.keys(allReflectMethods).toSorted();

        expect(reflectMethods.toSorted()).toEqual(expected);
    });

    test('being able to lazily resolve a dependency', () => {
        container.register('some', {
            factory: () => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const {SomeDependency} = require('./index.stub.js');

                return new SomeDependency(42);
            },
        });

        const dep = container.resolve<{index: number}>('some');
        expect(dep.index).toEqual(42);
    });

    test('resolve a non-lazy dependency as a proxy', () => {
        container.register('something', {
            factory: () => new Dependency('what'),
        });

        const proxy = container.lazyResolve('something');

        expect(isProxy(proxy)).toEqual(true);
    });

    test('resolve a lazy dependency as a proxy', () => {
        container.register('something', {
            factory: () => new Dependency('what'),
            lazy: true,
        });

        const proxy = container.lazyResolve('something');

        expect(isProxy(proxy)).toEqual(true);
    });

    test('cleanups with circular dependencies cause errors', async () => {
        const segments: string[] = [];

        class Something {
            constructor(
                public readonly name: string,
                private readonly collection: SomeCollection,
            ) {
            }

            allNames(): string[] {
                return this.collection.allNames();
            }
        }

        class SomeCollection {
            constructor(
                public readonly name: string,
                private readonly members: Something[],
            ) {
            }

            allNames(): string[] {
                return this.members.map(m => m.name);
            }
        }

        container.register<Something>('something', {
            factory: c => {
                return new Something(
                    'main',
                    c.resolve<SomeCollection>('collection'),
                );
            },
            shutdown: async instance => {
                segments.push(instance.name);
                await wait(2);
                segments.push(instance.name);
            },
        });

        container.register<SomeCollection>('collection', {
            lazy: true,
            factory: c => {
                return new SomeCollection(
                    'collection',
                    [c.resolve<Something>('something')],
                );
            },
            shutdown: async instance => {
                segments.push(instance.name);
                await wait(2);
                segments.push(instance.name);
            },
        });

        const something = container.resolve<Something>('something');

        expect(something.allNames()).toEqual(['main']);

        await expect(
            container.shutdown(),
        ).rejects.toThrow(
            new Error('Circular dependency detected in shutdown routine, could not shut down: something, collection.'),
        );

        expect(segments).toHaveLength(0);
    });
});

class Dependency {
    constructor(public readonly name: string) {}
}

class Middle {
    constructor(public readonly name: string, public readonly inner: Dependency) {

    }
}

class Outer {
    constructor(
        public readonly name: string,
        public readonly middle: Middle,
    ) {}
}