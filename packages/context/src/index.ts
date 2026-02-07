import {StandardError} from '@deltic/error-standard';

export type ContextValue = null | object | undefined | string | number | boolean | ContextValue[] | ContextObject;

export type ContextObject = {
    [index: string | number]: ContextValue;
};

export type ContextData<C> = {
    [K in keyof C]: C[K];
};

/**
 * This interface is intended to be compatible with AsyncLocalStorage so that context
 * can be scoped to HTTP requests and the processing of messages.
 */
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

/**
 * Function type for creating context values by merging inherited and provided values.
 */
export type CreateContextValue<C> = (inherited: Partial<C>, provided: Partial<C>) => Partial<C>;

/**
 * Default context value creator that merges inherited values with provided values.
 */
function defaultContextValueCreator<C>(inherited: Partial<C>, provided: Partial<C>): Partial<C> {
    return {...inherited, ...provided};
}

export class Context<C extends ContextData<C>> {
    constructor(
        private readonly storage: ContextStore<Partial<C>>,
        private readonly createContextValue: CreateContextValue<C> = defaultContextValueCreator,
    ) {}

    async run<R>(fn: () => Promise<R>, context: Partial<C> = {}): Promise<R> {
        const inherited = this.storage.getStore() ?? {};
        const merged = this.createContextValue(inherited, context);
        return this.storage.run(merged, fn);
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

// ============================================================================
// Composite Context
// ============================================================================

/**
 * Represents a single slot in a composite context with a typed key and optional default value.
 */
export interface ContextSlot<Key extends string, Value> {
    readonly key: Key;
    readonly defaultValue?: () => Value;
}

/**
 * Creates a context slot definition with a typed key and optional lazy default value.
 *
 * @example
 * const tenantSlot = defineContextSlot<'tenant_id', string>('tenant_id');
 * const userSlot = defineContextSlot<'user_id', string>('user_id', () => 'anonymous');
 */
export function defineContextSlot<const Key extends string, Value>(
    key: Key,
    defaultValue?: () => Value,
): ContextSlot<Key, Value> {
    return {key, defaultValue};
}

/**
 * Maps a record of named slots to their corresponding value types (using slot names as keys).
 */
export type CompositeContextData<Slots extends Record<string, ContextSlot<string, unknown>>> = {
    [K in keyof Slots]: Slots[K] extends ContextSlot<string, infer V> ? V : never;
};

/**
 * Maps slot names to their underlying context keys.
 */
type SlotKeyMapping<Slots extends Record<string, ContextSlot<string, unknown>>> = {
    [K in keyof Slots]: Slots[K] extends ContextSlot<infer Key, unknown> ? Key : never;
};

/**
 * The context data structure using slot keys (the actual keys stored in the context).
 */
export type ContextDataFromSlots<Slots extends Record<string, ContextSlot<string, unknown>>> = {
    [K in keyof Slots as SlotKeyMapping<Slots>[K]]: CompositeContextData<Slots>[K];
};

/**
 * Composes multiple context slots into a single Context with defaults support.
 *
 * The slots define the shape of the context and optional default values. After composition,
 * the result is a standard Context that can be used like any other Context.
 *
 * @example
 * const tenantSlot = defineContextSlot<'tenant_id', string>('tenant_id');
 * const userSlot = defineContextSlot<'user_id', string>('user_id', () => 'anonymous');
 *
 * const requestContext = composeContextSlots(
 *     {tenant: tenantSlot, user: userSlot},
 *     new AsyncLocalStorage(),
 * );
 *
 * await requestContext.run(async () => {
 *     requestContext.get('tenant_id'); // 'acme'
 *     requestContext.get('user_id');   // 'anonymous' (default)
 * }, {tenant_id: 'acme'});
 */
export function composeContextSlots<
    const Slots extends Record<string, ContextSlot<string, unknown>>,
>(
    slots: Slots,
    store: ContextStore<ContextDataFromSlots<Slots>> = new StaticContextStore<ContextDataFromSlots<Slots>>(),
): Context<ContextDataFromSlots<Slots>> {
    const slotEntries = Object.values(slots) as ContextSlot<string, unknown>[];

    function createContextValue(
        inherited: Partial<ContextDataFromSlots<Slots>>,
        provided: Partial<ContextDataFromSlots<Slots>>,
    ): Partial<ContextDataFromSlots<Slots>> {
        // Evaluate defaults for slots that have them
        const defaults: Record<string, unknown> = {};

        for (const slot of slotEntries) {
            if (slot.defaultValue !== undefined) {
                defaults[slot.key] = slot.defaultValue();
            }
        }

        // Merge: defaults < inherited < provided
        return {...defaults, ...inherited, ...provided} as Partial<ContextDataFromSlots<Slots>>;
    }

    return new Context(
        store as unknown as ContextStore<Partial<ContextDataFromSlots<Slots>>>,
        createContextValue,
    );
}
