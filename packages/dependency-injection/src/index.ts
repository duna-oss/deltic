interface Factory<T = any> {
    (container: DependencyContainer): T;
}

type ServiceDefinition<T = any> = {} & {
    factory: Factory<T>;
    lazy?: T extends object ? true : never;
} & ({
    cache?: true;
    shutdown?: (instance: T) => Promise<void> | void;
} | {
    cache: false;
    shutdown?: never;
});

type InstanceDefinition<T = any> = {
    instance: T;
    cache?: true;
    shutdown?: (instance: T) => Promise<void> | void;
};

/**
 * Represents a resolved service with its shutdown callback and direct dependencies.
 * Only services with shutdown callbacks are tracked.
 */
interface ResolvedService {
    key: string;
    shutdown?: (instance: any) => Promise<void> | void;
    dependencies: Set<string>;
    instance: any,
}

export class DependencyContainer {
    private cache: Record<string, any> = {};
    private definitions: Record<string, ServiceDefinition> = {};

    // Only track resolved services that have shutdown callbacks
    private readonly resolved = new Map<string, ResolvedService>();

    // Stack to track current resolution chain
    private resolutionStack: string[] = [];

    register<Service>(key: string, definition: ServiceDefinition<Service>): void {
        if (definition.lazy) {
            const proxy = this.createProxyFor(key, definition as ServiceDefinition<Service & object>);
            definition.factory = () => proxy;
        }

        this.definitions[key] = definition;
    }

    async shutdown(): Promise<void> {
        const levels = this.computeShutdownLevels();

        for (const level of levels) {
            await Promise.all(
                level.map(
                    key => {
                        const resolved = this.resolved.get(key);

                        return resolved?.instance === undefined
                            ? Promise.resolve()
                            : resolved.shutdown?.(resolved.instance);
                    }
                ),
            );
        }

        this.cache = {};
        this.resolved.clear();
    }

    /**
     * Computes shutdown levels using reverse topological sort.
     * Services in the same level have no dependencies between them and can shut down concurrently.
     * Levels are ordered from leaves (nothing depends on them) to roots (depends on nothing).
     */
    private computeShutdownLevels(): string[][] {
        const dependencies = new Map<string, Set<string>>();

        for (const [key, service] of this.resolved.entries()) {
            for (const dependency of service.dependencies) {
                if (!dependencies.has(dependency)) {
                    dependencies.set(dependency, new Set());
                }
                dependencies.get(dependency)!.add(key);
            }
        }


        const levels: string[][] = [];
        const processed = new Set<string>();
        const resolvedKeys = Array.from(this.resolved.keys());

        while (processed.size < resolvedKeys.length) {
            // Find services whose dependents have all been processed
            const currentLevel = resolvedKeys.filter(key => {
                if (processed.has(key)) return false;

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

            throw new Error(`Circular dependency detected in shutdown routine, could not shut down: ${[...missing].join(', ')}.`);
        }

        return levels;
    }

    /**
     * Records a dependency relationship between the nearest ancestor that is a shutdown
     * candidate. This may either be a lazy service, or a service with a shutdown callback.
     */
    private recordDependency(key: string): void {
        // for loops are more performant than findLast
        for (let i = this.resolutionStack.length - 1; i >= 0; i--) {
            const ancestor = this.resolutionStack[i];
            const ancestorService = this.resolved.get(ancestor);

            if (ancestorService) {
                ancestorService.dependencies.add(key);
                break; // Only record for the nearest parent
            }
        }
    }

    registerInstance<Service extends object>(key: string, definition: InstanceDefinition<Service>): void {
        const {shutdown, instance} = definition;
        this.cache[key] = instance;
        this.definitions[key] = {
            ...definition,
            factory: () => instance,
        };

        if (shutdown) {
            this.resolved.set(key, {
                key,
                shutdown,
                dependencies: new Set(),
                instance,
            });
        }
    }

    private createProxyFor<Service extends object>(key: string, definition: ServiceDefinition<Service>): Service {
        const {factory, cache = true, shutdown} = definition;
        const handlers: ProxyHandler<object> = {};
        let instance: object | undefined = undefined;
        const resolveInstance = () => {
            this.resolutionStack.push(key);
            const instance = factory(this);
            this.resolutionStack.pop();

            if (cache) {
                this.cache[key] = instance;
            }

            if (shutdown) {
                this.resolved.get(key)!.instance = instance;
            }


            this.cache[key] = instance;

            return instance;
        };

        for (const method of reflectMethods) {
            handlers[method] = (...args: any[]) => {
                args[0] = instance ??= resolveInstance();
                return (Reflect[method] as any)(...args);
            };
        }

        return new Proxy<object>({}, handlers) as Service;
    }

    lazyResolve<Service extends object>(key: string): Service {
        const definition = this.definitions[key];

        if (!definition) {
            throw new Error(`No definition found for key "${key}".`);
        }
        if (definition.lazy) {
            return this.cache[key]! ?? this.resolve<Service>(key);
        }

        return this.createProxyFor(key, definition);
    }

    resolve<Service>(key: string): Service {
        const cached = this.cache[key];

        if (cached) {
            // If this cached service has a shutdown callback, record the dependency
            if (this.resolved.has(key)) {
                this.recordDependency(key);
            }
            return cached;
        }

        const definition = this.definitions[key] as ServiceDefinition<Service>;

        if (definition === undefined) {
            throw new Error(`No definition found for key "${key}".`);
        }

        const {factory, shutdown, cache = true, lazy = false} = definition;

        // Register shutdown callback BEFORE executing factory so that child
        // dependencies can record this service as their parent
        if (shutdown || lazy) {
            this.resolved.set(key, {
                key,
                shutdown,
                dependencies: new Set(),
                instance: undefined,
            });

            this.recordDependency(key);
        }

        this.resolutionStack.push(key);
        const instance = factory(this);
        this.resolutionStack.pop();

        if (cache && !lazy) {
            if (shutdown) {
                this.resolved.get(key)!.instance = instance;
            }


            this.cache[key] = instance;
        }

        return instance;
    }
}

export const container = new DependencyContainer();

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