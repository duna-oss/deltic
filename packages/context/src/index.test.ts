import {
    composeContextSlots,
    Context,
    type ContextStore,
    CrossTenantOperationDetected,
    defineContextSlot,
    StaticContextStore,
    TenantContext,
    UnableToResolveTenantContext,
} from './index.js';
import {AsyncLocalStorage} from 'node:async_hooks';

interface MyContext {
    name: string;
    age: number;
    tenant_id: string;
}

let localStorage: AsyncLocalStorage<Partial<MyContext>>;

describe.each([
    ['static', () => new StaticContextStore<MyContext>({})],
    ['async_hooks', () => {
      return localStorage!;
    }],
] as const)('@deltic/context - %s', (_name, factory) => {
    let contextStore: ContextStore<MyContext>;
    let context: Context<MyContext>;
    let tenantContext: TenantContext<'tenant_id', string>;
    const setTenantId = (id: string | undefined) => tenantContext.use(id);
    const tenantOne = 'one';
    const tenantTwo = 'two';
    localStorage = new AsyncLocalStorage<Partial<MyContext>>({defaultValue: {}});
    localStorage.enterWith({});

    beforeEach(() => {
        localStorage.enterWith({});
        contextStore = factory();
        context = new Context(contextStore);
        tenantContext = new TenantContext<'tenant_id', string>(context, 'tenant_id');
    });

    test('retrieving the default values', () => {
        expect(contextStore.getStore()).toEqual({});
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
        expect(contextStore.getStore()).toEqual({});
    });

    test('getting specific values', async () => {
        expect(context.get('age')).toEqual(undefined);
        expect(context.get('name')).toEqual(undefined);

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

    test('getting the full context', () => {
        expect(context.context()).toEqual({});
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
        expect(tenantContext.resolve()).toEqual(void 0);

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

    test('failing to resolve the tenant identifier', () => {
        expect(() => tenantContext.mustResolve()).toThrow(UnableToResolveTenantContext);
    });

    test('when a valid tenant ID is set, does not throw', () => {
        setTenantId(tenantOne);
        expect(() => tenantContext.preventCrossTenantUsage(tenantOne)).not.toThrow();
    });

    test('when tenant ID is not set, throws UnableToResolveTenantContext', () => {
        setTenantId(undefined);
        expect(() => tenantContext.preventCrossTenantUsage(tenantOne)).toThrow(new UnableToResolveTenantContext());
    });

    test('when resolved tenant ID does not match given organization ID, throws expected error', () => {
        setTenantId(tenantTwo);

        expect(() => tenantContext.preventCrossTenantUsage(tenantOne)).toThrow(
            CrossTenantOperationDetected.forIds({
                expectedId: tenantTwo,
                tenantId: tenantOne,
            }),
        );
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
    ['StaticContextStore', () => new StaticContextStore<CompositeTestContext>({})],
    ['AsyncLocalStorage', () => {
        const storage = new AsyncLocalStorage<Partial<CompositeTestContext>>({defaultValue: {}});
        storage.enterWith({});
        return storage;
    }],
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
            {tenant: tenantSlot, user: userSlot},
            storeFactory(),
        );

        expect(ctx).toBeInstanceOf(Context);
    });

    test('run applies default values', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot, user: userSlot, trace: traceSlot},
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
            {tenant: tenantSlot, user: userSlot},
            storeFactory(),
        );

        await ctx.run(async () => {
            expect(ctx.get('tenant_id')).toBeUndefined();
            expect(ctx.get('user_id')).toEqual('frank');
        }, {user_id: 'frank'});
    });

    test('nested run inherits parent values', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot, user: userSlot, trace: traceSlot},
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

        const ctx = composeContextSlots({counter: counterSlot});

        await ctx.run(async () => {
            expect(ctx.get('counter')).toEqual(1);
        });

        await ctx.run(async () => {
            expect(ctx.get('counter')).toEqual(2);
        });
    });

    test('context.get returns value', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot},
            storeFactory(),
        );

        await ctx.run(async () => {
            expect(ctx.get('tenant_id')).toEqual('acme');
        }, {tenant_id: 'acme'});
    });

    test('context.attach updates value', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot},
            storeFactory(),
        );

        await ctx.run(async () => {
            ctx.attach({tenant_id: 'other-tenant'});
            expect(ctx.get('tenant_id')).toEqual('other-tenant');
        }, {tenant_id: 'acme'});
    });

    test('context.context returns full context snapshot', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot, user: userSlot},
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
            {tenant: tenantSlot},
            storeFactory(),
        );

        const tenantContext = new TenantContext(ctx, 'tenant_id');

        await ctx.run(async () => {
            expect(tenantContext.resolve()).toEqual('acme');
            expect(tenantContext.mustResolve()).toEqual('acme');
        }, {tenant_id: 'acme'});
    });

    test('explicit values override inherited in nested runs', async () => {
        const ctx = composeContextSlots(
            {tenant: tenantSlot, user: userSlot},
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
