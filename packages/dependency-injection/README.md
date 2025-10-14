# `@deltic/dependency-injection`

A lightweight dependency injection container with intelligent cleanup orchestration.

## Why this container?

Most DI containers force you to manually manage cleanup order or clean up everything registered (including unused
services). This container:

1. **Tracks actual usage** - only cleans up services that were resolved
2. **Respects dependencies** - services are cleaned up in reverse resolution order
3. **Maximizes concurrency** - independent services cleanup in parallel
4. **No magic** - dependencies resolved via simple factory functions

## What it gives you:

1. Factory function based dependency construction.
2. Smart dependency cleanup orchestration
3. Proxy-based lazy services
4. Instance registration

## Installation

```sh
npm i -S @deltic/dependency-injection
# or
pnpm add @deltic/dependency-injection
```

## Usage

```typescript
import {DependencyContainer, container} from '@deltic/dependency-injection';

const myContainer = new DependencyContainer(); // or use the default container

class MyNameService {
    constructor(
        private readonly firstName: string,
        private readonly dependency: MyLastNameService,
    ) {
    }

    fullName(): string {
        return `${this.firstName} ${this.dependency.lastName}`;
    }
}

class MyLastNameService {
    constructor(
        public readonly lastName: string,
    ) {
    }
}

container.registerInstance<MyLastNameService>('my.last_name_service', {
    instance: new MyLastNameService('de Jonge'),
});

container.register<MyNameService>('my.name_service', {
    factory: container => {
        return new MyNameService(
            'Frank',
            container.resolve('my.last_name_service'),
        )
    }
});

const service = container.resolve<MyNameService>('my.name_service');

expect(service.fullName()).toEqual('Frank de Jonge');
```

## Common Problems &amp; Solutions

### Problem: A stateful service needs to be shut down

A common problem for stateful services, like database pools or redis connections. These services
need to be cleaned up so our applications can gracefully shut down.

#### Solution: Service cleanups

```typescript
import {container} from '@deltic/dependency-injection';
import {Pool} from 'pg';

container.register<Pool>('pg.pool', {
    factory: () => new Pool({
        host: 'localhost',
        user: 'database-user',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        maxLifetimeSeconds: 60
    }),
    cleanup: async pool => {
        await pool.end();
    },
});

const pool = container.resolve<Pool>('pg.pool');

// use the pool

await container.cleanup();
```

### Problem: Circular dependencies between services

Never a nice problem to have, but Proxy's to the rescue! Deltic uses proxies, which break cyclical
dependency resolution. This is a standard approach used by almost all DI containers.

#### Solution: Declare your dependency as `lazy: true`

```typescript
import {container} from '@deltic/dependency-injection';

container.register<Something>('something', {
    factory: c => {
        return new Something(
            'something-name',
            c.resolve<SomeCollection>('collection'),
        );
    },
});

container.register<SomeCollection>('collection', {
    lazy: true,
    factory: container => {
        return new SomeCollection(
            'collection-name',
            [container.resolve<Something>('something')],
        );
    },
});

// ALTERNATIVE

container.register<Something>('something', {
    factory: container => {
        return new Something(
            'something-name',
            container.resolveLazy<SomeCollection>('collection'),
            // ------------- ^ load it lazy,
        );
    },
});

container.register<SomeCollection>('collection', {
    factory: container => {
        return new SomeCollection(
            'collection-name',
            [container.resolve<Something>('something')],
        );
    },
});
```

## Type Safety

Service keys are strings, which means typos won't be caught at compile time. To mitigate this:

1. **Use constants** for service keys to enable autocomplete and refactoring
2. **Colocate registration** with service definitions
3. **Add integration tests** to verify expected services are registered

Missing service resolution throws a descriptive error with the attempted key.

## How It Compares

| Feature                        | @deltic/dependency-injection | tsyringe | inversify |
|--------------------------------|------------------------------|----------|-----------|
| Only cleanup used services     | ✅                            | ❌        | ❌         |
| Dependency-aware cleanup order | ✅                            | ❌        | ❌         |
| Concurrent cleanup             | ✅                            | ❌        | ❌         |
| Decorators required            | ❌                            | ✅        | ✅         |
| Reflection metadata            | ❌                            | ✅        | ✅         |

