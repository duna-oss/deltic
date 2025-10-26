/* eslint-disable @typescript-eslint/no-empty-object-type */
interface Factory<S extends ServicesStructure<S>, T = any> {
    (container: DependencyContainer<S>): T;
}

type ServiceDefinition<S extends ServicesStructure<S>, T = any> = {} & {
    factory: Factory<S, T>;
    lazy?: T extends object ? true : never;
} & ({
    cache?: true;
    cleanup?: (instance: T) => Promise<void> | void;
} | {
    cache: false;
    cleanup?: never;
});

type InstanceDefinition<T = any> = {
    instance: T;
    cache?: true;
    cleanup?: (instance: T) => Promise<void> | void;
};

/**
 * Represents a resolved service with its cleanup callback and direct dependencies.
 * Only services with cleanup callbacks are tracked.
 */
interface ResolvedService {
    key: string | number | symbol;
    cleanup?: (instance: any) => Promise<void> | void;
    dependencies: Set<string | number | symbol>;
    instance: any,
}

export type ServicesStructure<D> = {
    [K in keyof D]: any
};

export class DependencyContainer<Services extends ServicesStructure<Services> = ServiceRegistry> {
    private cache: Partial<Services> = {};
    private definitions: Partial<Record<keyof Services, ServiceDefinition<Services>>> = {};

    // Only track resolved services that have cleanup callbacks
    private readonly resolved = new Map<keyof Services, ResolvedService>();

    // Stack to track current resolution chain
    private resolutionStack = new Set<keyof Services>();

    register<Key extends keyof Services>(key: Key, definition: ServiceDefinition<Services, Services[Key]>): void {
        if (definition.lazy) {
            const proxy = this.createProxyFor(key, definition as ServiceDefinition<Services, Services[Key]& object>);
            definition.factory = () => proxy;
        }

        this.definitions[key] = definition;
    }

    async cleanup(): Promise<void> {
        const levels = this.computeShutdownLevels();

        for (const level of levels) {
            await Promise.all(
                level.map(
                    key => {
                        const resolved = this.resolved.get(key as keyof Services);

                        return resolved?.instance === undefined
                            ? Promise.resolve()
                            : resolved.cleanup?.(resolved.instance);
                    }
                ),
            );
        }

        this.cache = {};
        this.resolved.clear();
    }

    /**
     * Computes cleanup levels using reverse topological sort.
     * Services in the same level have no dependencies between them and can shut down concurrently.
     * Levels are ordered from leaves (nothing depends on them) to roots (depends on nothing).
     */
    private computeShutdownLevels(): (keyof Services)[][] {
        const dependencies = new Map<keyof Services, Set<keyof Services>>();

        for (const [key, service] of this.resolved.entries()) {
            for (const dependency of service.dependencies) {
                if (!dependencies.has(dependency as keyof Services)) {
                    dependencies.set(dependency as keyof Services, new Set());
                }
                dependencies.get(dependency as keyof Services)!.add(key);
            }
        }

        const levels: (keyof Services)[][] = [];
        const processed = new Set<keyof Services>();
        const resolvedKeys = Array.from(this.resolved.keys());

        while (processed.size < resolvedKeys.length) {
            // Find services whose dependents have all been processed
            const currentLevel = resolvedKeys.filter(key => {
                if (processed.has(key)) {
                    return false;
                }

                const serviceDependents = dependencies.get(key) ?? new Set();

                return processed.isSupersetOf(serviceDependents);
            });

            if (currentLevel.length === 0) {
                break;
            }

            levels.push(currentLevel);
            currentLevel.forEach(key => processed.add(key));
        }

        if (processed.size < resolvedKeys.length) {
            const missing = new Set(resolvedKeys).difference(processed);

            throw new Error(`Circular dependency detected in cleanup routine, could not shut down: ${[...missing].join(', ')}.`);
        }

        return levels;
    }

    /**
     * Records a dependency relationship between the nearest ancestor that is a cleanup
     * candidate. This may either be a lazy service, or a service with a cleanup callback.
     */
    private recordDependency(key: keyof Services): void {
        const resolutionStack = Array.from(this.resolutionStack).toReversed();

        // for loops are more performant than findLast
        for (const ancestor of resolutionStack) {
            const ancestorService = this.resolved.get(ancestor);

            if (ancestorService) {
                ancestorService.dependencies.add(key);
                break; // Only record for the nearest parent
            }
        }
    }

    registerInstance<Key extends keyof Services>(key: Key, definition: InstanceDefinition<Services[Key]>): void {
        const {cleanup, instance} = definition;
        this.cache[key] = instance;
        this.definitions[key] = {
            ...definition,
            factory: () => instance,
        };

        if (cleanup) {
            this.resolved.set(key, {
                key,
                cleanup,
                dependencies: new Set(),
                instance,
            });
        }
    }

    private createProxyFor<Key extends keyof Services>(key: Key, definition: ServiceDefinition<Services, Services[Key]>): Services[Key] {
        const {factory, cache = true, cleanup} = definition;
        const resolveInstance = () => {
            const cached = this.cache[key];

            if (cached) {
                return cached;
            }

            this.resolutionStack.add(key);
            const instance = factory(this);
            this.resolutionStack.delete(key);

            if (cache) {
                this.cache[key] = instance;
            }

            if (cleanup) {
                this.resolved.get(key)!.instance = instance;
            }

            this.cache[key] = instance;

            return instance;
        };

        return this.createProxy(resolveInstance as any);
    }

    private createProxy<Instance extends Services[keyof Services]>(createInstance: () => Instance): Instance {
        let instance: Instance | undefined = undefined;
        const handlers: ProxyHandler<Instance> = {};

        for (const method of reflectMethods) {
            handlers[method] = (...args: any[]) => {
                args[0] = instance ??= createInstance();
                return (Reflect[method] as any)(...args);
            };
        }

        return new Proxy<Instance>({} as Instance, handlers);
    }

    resolveLazy<const Key extends keyof Services>(key: Key): Services[Key] {
        const definition = this.definitions[key] as ServiceDefinition<Services, Services[Key]> | undefined;

        if (!definition) {
            throw new Error(`No definition found for key "${String(key)}".`);
        }

        this.recordDependency(key);

        return this.createProxyFor(key, definition as any);
    }

    resolve<Key extends keyof Services>(key: Key): Services[Key] {
        if (this.resolutionStack.has(key)) {
            return this.resolveLazy<Key>(key);
        }

        const cached = this.cache[key];

        if (cached) {
            // If this cached service has a cleanup callback, record the dependency
            if (this.resolved.has(key)) {
                this.recordDependency(key);
            }

            return cached;
        }

        const definition = this.definitions[key] as ServiceDefinition<Services, Services[Key]> | undefined;

        if (definition === undefined) {
            throw new Error(`No definition found for key "${key.toString()}".`);
        }

        const {factory, cleanup, cache = true, lazy = false} = definition;

        // Register cleanup callback BEFORE executing factory so that child
        // dependencies can record this service as their parent
        if (cleanup || lazy) {
            this.resolved.set(key, {
                key,
                cleanup,
                dependencies: new Set(),
                instance: undefined,
            });

            this.recordDependency(key);
        }

        this.resolutionStack.add(key);
        const instance = factory(this);
        this.resolutionStack.delete(key);

        if (cache && !lazy) {
            if (cleanup) {
                this.resolved.get(key)!.instance = instance;
            }


            this.cache[key] = instance;
        }

        return instance;
    }
}

export interface ServiceRegistry {
}

export const container = new DependencyContainer<ServiceRegistry>();

/**
 * @internal
 */
export const reflectMethods = [
    'apply',
    'construct',
    'defineProperty',
    'deleteProperty',
    'get',
    'getOwnPropertyDescriptor',
    'getPrototypeOf',
    'has',
    'isExtensible',
    'ownKeys',
    'preventExtensions',
    'set',
    'setPrototypeOf',
] as const;