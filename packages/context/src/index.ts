import {StandardError} from '@deltic/error-standard';

export type ContextValue = null | object | undefined | string | number | boolean | ContextValue[] | ContextObject;

export type ContextObject = {
    [index: string | number]: ContextValue;
};

export type ContextData<C> = {
    [K in keyof C]: C[K];
};

export interface ContextStore<C extends ContextData<C>> {
    getStore(): Partial<C> | undefined;
    enterWith(store: Partial<C>): void;
    run<R>(store: Partial<C>, callback: () => Promise<R>): Promise<R>;
}

export class StaticContextStore<C extends ContextData<C>> implements ContextStore<C> {
    constructor(private context: Partial<C> = {}) {}

    enterWith(store: Partial<C>): void {
        this.context = {...this.context, ...store};
    }

    getStore(): Partial<C> | undefined {
        return this.context;
    }

    async run<R>(store: Partial<C>, callback: () => Promise<R>): Promise<R> {
        const previous = this.context;
        this.context = store;
        const response = await callback();
        this.context = previous;

        return response;
    }
}

export class Context<C extends ContextData<C>> {
    constructor(private readonly storage: ContextStore<Partial<C>>) {}

    async run<R>(fn: () => Promise<R>, context: Partial<C> = {}): Promise<R> {
        return this.storage.run(context, fn);
    }

    attach(context: Partial<C>): void {
        const store = this.storage.getStore();

        if (store === undefined) {
            throw new Error('No async context available, missing middleware or consumer decorator?');
        }

        for (const [key, value] of Object.entries(context)) {
            (store as any)[key] = value;
        }
    }

    get<K extends keyof C>(key: K): C[K] | undefined {
        return this.storage.getStore()?.[key];
    }

    context(): Partial<C> {
        return this.storage.getStore() ?? {};
    }
}

export interface ContextValueReader<TenantId> {
    resolve(): TenantId | undefined;
    mustResolve(): TenantId;
    preventCrossTenantUsage(tenantId: TenantId): void;
}

export interface ContextValueWriter<TenantId> extends ContextValueReader<TenantId> {
    use(context?: TenantId): void;
    forget(): void;
}

export class SyncTenantContext<TenantId extends string | number> implements ContextValueWriter<TenantId> {
    constructor(private tenantContext?: TenantId) {}

    resolve(): TenantId | undefined {
        return this.tenantContext;
    }

    preventCrossTenantUsage(tenantId: TenantId) {
        preventCrossTenantUsage({expectedId: this.mustResolve(), tenantId});
    }

    mustResolve(): TenantId {
        if (this.tenantContext === undefined) {
            throw new UnableToResolveTenantContext();
        }

        return this.tenantContext;
    }

    use(context?: TenantId): void {
        this.tenantContext = context;
    }

    forget(): void {
        this.use(undefined);
    }
}

type KeyValueToObject<Key extends string, Value extends string | number> = {
    [K in Key]: Value;
};

export class TenantContext<
    const Key extends string,
    Value extends string | number,
> implements ContextValueWriter<Value> {
    constructor(
        private readonly context: Context<KeyValueToObject<Key, Value>>,
        private readonly key: Key,
    ) {}

    forget(): void {
        this.use(undefined);
    }

    resolve(): Value | undefined {
        return this.context.get(this.key);
    }

    use(value: Value | undefined): void {
        this.context.attach({
            [this.key]: value,
        } as KeyValueToObject<Key, Value>);
    }

    preventCrossTenantUsage(value: Value) {
        preventCrossTenantUsage({expectedId: this.mustResolve(), tenantId: value});
    }

    mustResolve(): Value {
        const resolved = this.resolve();

        if (resolved === undefined) {
            throw new UnableToResolveTenantContext();
        }

        return resolved;
    }
}

export class UnableToResolveTenantContext extends StandardError {
    constructor() {
        super('Tenant ID not found in context. Forgot to set it?', 'context.unable_to_resolve_tenant_context');
    }
}

export function preventCrossTenantUsage<TenantId extends string | number>(context: {
    expectedId: TenantId;
    tenantId: TenantId;
}): void {
    if (context.tenantId !== context.expectedId) {
        throw CrossTenantOperationDetected.forIds(context);
    }
}

export class CrossTenantOperationDetected extends StandardError {
    static forIds<TenantId extends string | number>({
        expectedId,
        tenantId,
    }: {
        expectedId: TenantId;
        tenantId: TenantId;
    }) {
        return new CrossTenantOperationDetected(
            `Cross-tenant operation detected. Expected ${String(expectedId)} detected ${String(tenantId)}`,
            'context.cross_tenant_operation_detected',
            {expectedId, tenantId},
        );
    }
}
