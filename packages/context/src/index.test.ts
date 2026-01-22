import {
    Context,
    type ContextStore,
    CrossTenantOperationDetected, StaticContextStore, TenantContext, UnableToResolveTenantContext,
} from './index.js';
import {AsyncLocalStorage} from 'node:async_hooks';

interface MyContext {
    name: string,
    age: number,
    tenant_id: string,
}

const localStorage = new AsyncLocalStorage<Partial<MyContext>>({defaultValue: {}});

describe.each([
    ['static', () => new StaticContextStore<MyContext>({})],
    ['async_hooks', () => localStorage],
] as const)('@deltic/context - %s', (_name, factory) => {
    let contextStore: ContextStore<MyContext>;
    let context: Context<MyContext>;
    let tenantContext: TenantContext<'tenant_id', string>;
    const setTenantId = (id: string | undefined) => tenantContext.use(id);
    const tenantOne = 'one';
    const tenantTwo = 'two';

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

        await contextStore.run({
            name: 'Other',
            age: 128,
        }, async () => {
            store = contextStore.getStore();
        });

        expect(store).toEqual({name: 'Other', age: 128});
        expect(contextStore.getStore()).toEqual({});
    });

    test('getting specific values', async () => {
        expect(context.get('age')).toEqual(undefined);
        expect(context.get('name')).toEqual(undefined);

        let name: string | undefined;
        let age: number | undefined;

        await context.run(async () => {
            const scoped = context.context();
            name = scoped.name;
            age = scoped.age;
        }, {
            name: 'Frank',
            age: 16,
        });

        expect(name).toEqual('Frank');
        expect(age).toEqual(16);
    });

    test('getting the full context', () => {
        expect(context.context()).toEqual({});
    });

    test('attaching additional context', async () => {
        let name: string | undefined;
        let age: number | undefined;

        await context.run(async () => {
            context.attach({
                name: 'Frank',
            });
            name = context.get('name');
            age = context.get('age');
        }, {
            age: 37,
        });

        expect(name).toEqual('Frank');
        expect(age).toEqual(37);
    });

    test('running with with less context', async () => {
        let name: string | undefined;
        let age: number | undefined;

        await context.run(async () => {
           await context.run(async () => {
               name = context.get('name');
               age = context.get('age');
           }, {
               name: 'Jane',
           });
        }, {
            name: 'Frank',
            age: 37,
        });

        expect(name).toEqual('Jane');
        expect(age).toEqual(undefined);
    });

    test('using tenant context', async () => {
        expect(tenantContext.resolve()).toEqual(void 0);

        let tenantId: string | undefined;

        await context.run(async () => {
            tenantId = tenantContext.mustResolve();
        }, {
            tenant_id: 'what is up',
        });

        expect(tenantId).toEqual('what is up');
    });

    test('failing to resolve the tenant identifier', () => {
        expect(() => tenantContext.mustResolve()).toThrow(UnableToResolveTenantContext);
    });

    test('when a valid tenant ID is set, does not throw', () => {
        setTenantId(tenantOne);
        expect(() => tenantContext.preventCrossTenantUsage(tenantOne))
            .not
            .toThrow();
    });

    test('when tenant ID is not set, throws UnableToResolveTenantContext', () => {
        setTenantId(undefined);
        expect(() => tenantContext.preventCrossTenantUsage(tenantOne))
            .toThrow(new UnableToResolveTenantContext());
    });

    test('when resolved tenant ID does not match given organization ID, throws expected error', () => {
        setTenantId(tenantTwo);

        expect(() => tenantContext.preventCrossTenantUsage(tenantOne))
            .toThrow(CrossTenantOperationDetected.forIds({
                expectedId: tenantTwo,
                tenantId: tenantOne,
            }));
    });
});
