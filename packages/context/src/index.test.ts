import {
    composeContextSlots,
    Context,
    type ContextStore,
    ContextMismatchDetected,
    defineContextSlot,
    ContextStoreUsingMemory,
    ValueReadWriterUsingContext,
    UnableToResolveValue,
} from './index.js';
import {AsyncLocalStorage} from 'node:async_hooks';

interface MyContext {
    name: string;
    age: number;
    tenant_id: string;
}

describe.each([
    ['static', () => new ContextStoreUsingMemory<MyContext>({})],
    ['async_hooks', () => new AsyncLocalStorage<Partial<MyContext>>()],
] as const)('@deltic/context - %s', (_name, factory) => {
    let contextStore: ContextStore<MyContext>;
    let context: Context<MyContext>;
    let tenantContext: ValueReadWriterUsingContext<'tenant_id', string>;
    const tenantOne = 'one';
    const tenantTwo = 'two';

    beforeEach(() => {
        contextStore = factory();
        context = new Context(contextStore);
        tenantContext = new ValueReadWriterUsingContext<'tenant_id', string>(context, 'tenant_id');
    });

    test('running with different scope', async () => {
        let store: Partial<MyContext> | undefined;

        await contextStore.run(
            {
                name: 'Other',
                age: 128,
            },
            async () => {
                store = contextStore.getStore();
            },
        );

        expect(store).toEqual({name: 'Other', age: 128});
    });

    test('getting specific values', async () => {
        let name: string | undefined;
        let age: number | undefined;

        await context.run(
            async () => {
                const scoped = context.context();
                name = scoped.name;
                age = scoped.age;
            },
            {
                name: 'Frank',
                age: 16,
            },
        );

        expect(name).toEqual('Frank');
        expect(age).toEqual(16);
    });

    test('getting the full context', async () => {
        await context.run(async () => {
            expect(context.context()).toEqual({});
        });
    });

    test('attaching additional context', async () => {
        let name: string | undefined;
        let age: number | undefined;

        await context.run(
            async () => {
                context.attach({
                    name: 'Frank',
                });
                name = context.get('name');
                age = context.get('age');
            },
            {
                age: 37,
            },
        );

        expect(name).toEqual('Frank');
        expect(age).toEqual(37);
    });

    test('nested runs inherit parent context values', async () => {
        let name: string | undefined;
        let age: number | undefined;

        await context.run(
            async () => {
                await context.run(
                    async () => {
                        name = context.get('name');
                        age = context.get('age');
                    },
                    {
                        name: 'Jane',
                    },
                );
            },
            {
                name: 'Frank',
                age: 37,
            },
        );

        expect(name).toEqual('Jane');
        expect(age).toEqual(37); // inherited from parent
    });

    test('using tenant context', async () => {
        let tenantId: string | undefined;

        await context.run(
            async () => {
                tenantId = tenantContext.mustResolve();
            },
            {
                tenant_id: 'what is up',
            },
        );

        expect(tenantId).toEqual('what is up');
    });

    test('failing to resolve the tenant identifier', async () => {
        await context.run(async () => {
            expect(() => tenantContext.mustResolve()).toThrow(UnableToResolveValue);
        });
    });

    test('when a valid tenant ID is set, does not throw', async () => {
        await context.run(async () => {
            tenantContext.use(tenantOne);
            expect(() => tenantContext.preventMismatch(tenantOne)).not.toThrow();
        });
    });

    test('when tenant ID is not set, throws UnableToResolveTenantContext', async () => {
        await context.run(async () => {
            tenantContext.use(undefined);
            expect(() => tenantContext.preventMismatch(tenantOne)).toThrow(new UnableToResolveValue());
        });
    });

    test('when resolved tenant ID does not match given organization ID, throws expected error', async () => {
        await context.run(async () => {
            tenantContext.use(tenantTwo);

            expect(() => tenantContext.preventMismatch(tenantOne)).toThrow(
                ContextMismatchDetected.forIds({
                    expectedId: tenantTwo,
                    tenantId: tenantOne,
                }),
            );
        });
    });
});

// ============================================================================
// Composite Context Tests
// ============================================================================

interface CompositeTestContext {
    tenant_id: string;
    user_id: string;
    trace_id: string;
}

describe.each([
    ['StaticContextStore', () => new ContextStoreUsingMemory<CompositeTestContext>({})],
    ['AsyncLocalStorage', () => new AsyncLocalStorage<Partial<CompositeTestContext>>()],
] as const)('composeContextSlots - %s', (_name, storeFactory) => {
    // Define slots for testing
    const tenantSlot = defineContextSlot<'tenant_id', string>('tenant_id');
    const userSlot = defineContextSlot<'user_id', string>('user_id', () => 'anonymous');
    const traceSlot = defineContextSlot<'trace_id', string>('trace_id', () => 'generated-trace-id');

    test('defineContextSlot creates a slot with key', () => {
        expect(tenantSlot.key).toEqual('tenant_id');
        expect(tenantSlot.defaultValue).toBeUndefined();
    });

    test('defineContextSlot creates a slot with key and default value', () => {
        expect(userSlot.key).toEqual('user_id');
        expect(userSlot.defaultValue).toBeDefined();
        expect(userSlot.defaultValue!()).toEqual('anonymous');
    });

    test('composeContextSlots returns a Context', () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot],
            storeFactory(),
        );

        expect(ctx).toBeInstanceOf(Context);
    });

    test('run applies default values', async () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot, traceSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            expect(ctx.get('tenant_id')).toEqual('acme');
            expect(ctx.get('user_id')).toEqual('anonymous');
            expect(ctx.get('trace_id')).toEqual('generated-trace-id');
        }, {tenant_id: 'acme'});
    });

    test('slots without defaults remain undefined', async () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            expect(ctx.get('tenant_id')).toBeUndefined();
            expect(ctx.get('user_id')).toEqual('frank');
        }, {user_id: 'frank'});
    });

    test('nested run inherits parent values', async () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot, traceSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            await ctx.run(async () => {
                // tenant and trace inherited from parent
                expect(ctx.get('tenant_id')).toEqual('acme');
                expect(ctx.get('trace_id')).toEqual('trace-1');
                // user overridden
                expect(ctx.get('user_id')).toEqual('frank');
            }, {user_id: 'frank'});

            // parent context unchanged
            expect(ctx.get('user_id')).toEqual('admin');
        }, {tenant_id: 'acme', user_id: 'admin', trace_id: 'trace-1'});
    });

    test('defaults are re-evaluated on each run', async () => {
        let counter = 0;
        const counterSlot = defineContextSlot<'counter', number>('counter', () => ++counter);

        const ctx = composeContextSlots([counterSlot]);

        await ctx.run(async () => {
            expect(ctx.get('counter')).toEqual(1);
        });

        await ctx.run(async () => {
            expect(ctx.get('counter')).toEqual(2);
        });
    });

    test('context.get returns value', async () => {
        const ctx = composeContextSlots(
            [tenantSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            expect(ctx.get('tenant_id')).toEqual('acme');
        }, {tenant_id: 'acme'});
    });

    test('context.attach updates value', async () => {
        const ctx = composeContextSlots(
            [tenantSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            ctx.attach({tenant_id: 'other-tenant'});
            expect(ctx.get('tenant_id')).toEqual('other-tenant');
        }, {tenant_id: 'acme'});
    });

    test('context.context returns full context snapshot', async () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            const snapshot = ctx.context();
            expect(snapshot).toHaveProperty('tenant_id', 'acme');
            expect(snapshot).toHaveProperty('user_id', 'anonymous');
        }, {tenant_id: 'acme'});
    });

    test('TenantContext can be created from composed context', async () => {
        const ctx = composeContextSlots(
            [tenantSlot],
            storeFactory(),
        );

        const tenantContext = new ValueReadWriterUsingContext(ctx, 'tenant_id');

        await ctx.run(async () => {
            expect(tenantContext.resolve()).toEqual('acme');
            expect(tenantContext.mustResolve()).toEqual('acme');
        }, {tenant_id: 'acme'});
    });

    test('explicit values override inherited in nested runs', async () => {
        const ctx = composeContextSlots(
            [tenantSlot, userSlot],
            storeFactory(),
        );

        await ctx.run(async () => {
            await ctx.run(async () => {
                expect(ctx.get('tenant_id')).toEqual('other-tenant');
                expect(ctx.get('user_id')).toEqual('admin'); // inherited
            }, {tenant_id: 'other-tenant'});
        }, {tenant_id: 'acme', user_id: 'admin'});
    });
});
