import {DependencyContainer, reflectMethods, container as exportedContainer} from './index.js';
import {isProxy} from 'node:util/types';
import {setTimeout as wait} from 'node:timers/promises';

interface Inner {
    lol: 'what';
}

declare module '@deltic/dependency-injection' {
    interface ServiceRegistry {
        something: Dependency,
        outer: {
            dependency: Inner,
        },
        inner: Inner,
        'complex-inner': Dependency,
        'middle-lazy': Middle,
        'middle-normal': Middle,
        'outer-lazy': Outer,
        'outer-normal': Outer,
        'some': {index: number},
        'some-instance': SomeInstance,
        'some-collection': SomeCollection,
    }
}

describe('@deltic/dependency-injection', () => {
    let container: DependencyContainer;

    beforeEach(() => container = new DependencyContainer());

    test('the exported container is a Dependency', () => {
        expect(exportedContainer).toBeInstanceOf(DependencyContainer);
    });

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
            const something = container.resolve('something');
            segments.push('resolved');
            expect(something.name).toEqual('something');
            segments.push('after');
            expect(segments.join('-')).toEqual('before-resolved-during-after');
        });

        test('the next resolve is the actual instance', () => {
            let something = container.resolve('something');
            expect(something).toBeInstanceOf(Dependency);
            expect(isProxy(something)).toEqual(true);
            something = container.resolve('something');
            expect(something).toBeInstanceOf(Dependency);
            expect(isProxy(something)).toEqual(false);
        });

        // test('when not caching, you will always get a proxy', )
    });

    /**
     * Cleanups are a tad primitive right now, it sequentially executes the cleanup callbacks in
     * reverse order of resolving. This is to ensure each instance can shut down whilst their
     * dependencies have not yet shut down, ensuring their cleanup has functional dependencies.
     *
     * At a later point in time, a more sophisticated cleanup routine may be used.
     */
    describe('cleanups - one service depending on another', () => {
        let segments: string[];

        beforeEach(() => {
            segments = [];
            container.register('outer', {
                factory: container => ({
                    dependency: container.resolve('inner'),
                }),
                cleanup: async () => {
                    segments.push('outer');
                },
            });

            container.register('inner', {
                factory: () => ({
                    lol: 'what',
                }),
                cleanup: async () => {
                    segments.push('inner');
                },
            });
        });

        test('cleanups are not triggered when the instances are not resolved', async () => {
            await container.cleanup();

            expect(segments).toHaveLength(0);
        });

        test('when one service is resolved, one cleanup happens', async () => {
            container.resolve('inner');

            await container.cleanup();

            expect(segments).toHaveLength(1);
            expect(segments[0]).toEqual('inner');
        });

        test('when two service is resolved, cleanup happens in order', async () => {
            container.resolve('outer');

            await container.cleanup();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });

        test('when two service is explicitly resolved, cleanup happens in order', async () => {
            container.resolve('outer');
            container.resolve('inner');

            await container.cleanup();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });

        test('when two service is explicitly resolved in reversed, cleanup still happens in order', async () => {
            container.resolve('inner');
            container.resolve('outer');

            await container.cleanup();

            expect(segments).toHaveLength(2);
            expect(segments[0]).toEqual('outer');
            expect(segments[1]).toEqual('inner');
        });
    });

    describe('complex cleanups are concurrent', () => {
        const segments: string[] = [];

        beforeEach(() => {
            segments.length = 0;

            container.register('complex-inner', {
                factory: () => new Dependency('complex-inner'),
                cleanup: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });

            container.register('middle-normal', {
                factory: c => {
                    return new Middle('middle-normal', c.resolve('complex-inner'));
                },
            });

            container.register('middle-lazy', {
                lazy: true,
                factory: c => {
                    return new Middle('middle-lazy', c.resolve('complex-inner'));
                },
            });

            container.register('outer-normal', {
                factory: c => {
                    const middle = c.resolve('middle-normal');
                    return new Outer('outer-normal', middle);
                },
                cleanup: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });

            container.register('outer-lazy', {
                factory: c => {
                    const middle = c.resolve('middle-lazy');
                    return new Outer('outer-lazy', middle);
                },
                lazy: true,
                cleanup: async instance => {
                    segments.push(instance.name);
                    await wait(2);
                    segments.push(instance.name);
                },
            });
        });

        test('resolving outer normal', async () => {
            const outerNormal = container.resolve('outer-normal');

            expect(outerNormal.name).toEqual('outer-normal');
            expect(outerNormal.middle.name).toEqual('middle-normal');
            expect(outerNormal.middle.inner.name).toEqual('complex-inner');

            await container.cleanup();

            expect(segments).toEqual([
                'outer-normal',
                'outer-normal',
                'complex-inner',
                'complex-inner',
            ]);
        });

        test('resolving outer lazy', async () => {
            const outerLazy = container.resolve('outer-lazy');

            expect(outerLazy.name).toEqual('outer-lazy');
            expect(outerLazy.middle.name).toEqual('middle-lazy');
            expect(outerLazy.middle.inner.name).toEqual('complex-inner');

            await container.cleanup();

            expect(segments).toEqual([
                'outer-lazy',
                'outer-lazy',
                'complex-inner',
                'complex-inner',
            ]);
        });

        test('resolving and use both (and trigger lazy proxy)', async () => {
            container.resolve('outer-normal');
            const lazy = container.resolve('outer-lazy');

            expect(lazy.name).toEqual('outer-lazy');

            await container.cleanup();

            expect(segments).toEqual([
                'outer-normal',
                'outer-lazy',
                'outer-normal',
                'outer-lazy',
                'complex-inner',
                'complex-inner',
            ]);
        });

        test('cleanups are no invoked for lazy services that are not used', async () => {
            container.resolve('outer-lazy');

            await container.cleanup();

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

        const dep = container.resolve('some');
        expect(dep.index).toEqual(42);
    });

    test('resolve a non-lazy dependency as a proxy', () => {
        container.register('something', {
            factory: () => new Dependency('what'),
        });

        const proxy = container.resolveLazy('something');

        expect(isProxy(proxy)).toEqual(true);
    });

    test('resolve a lazy dependency as a proxy', () => {
        container.register('something', {
            factory: () => new Dependency('what'),
            lazy: true,
        });

        const proxy = container.resolveLazy('something');

        expect(isProxy(proxy)).toEqual(true);
    });

    test('shutting down registered instances', async () => {
        const instance = new Dependency('name');
        let hascleanup = false;

        container.registerInstance('something', {
            instance,
            cleanup: () => {
                hascleanup = true;
            },
        });

        await container.cleanup();

        expect(hascleanup).toEqual(true);
    });

    test('cleanups with circular dependencies cause errors', async () => {
        const segments: string[] = [];

        container.register('some-instance', {
            factory: c => {
                return new SomeInstance(
                    'main',
                    c.resolve('some-collection'),
                );
            },
            cleanup: async instance => {
                segments.push(instance.name);
                await wait(2);
                segments.push(instance.name);
            },
        });

        container.register('some-collection', {
            factory: c => {
                return new SomeCollection(
                    'collection',
                    [c.resolve('some-instance')],
                );
            },
            cleanup: async instance => {
                segments.push(instance.name);
                await wait(2);
                segments.push(instance.name);
            },
        });

        const something = container.resolve('some-instance');

        expect(something.allNames()).toEqual(['main']);

        await expect(container.cleanup()).rejects.toThrow();

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

class SomeInstance {
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
        private readonly members: SomeInstance[],
    ) {
    }

    allNames(): string[] {
        return this.members.map(m => m.name);
    }
}