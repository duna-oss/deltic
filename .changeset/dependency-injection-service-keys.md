---
"@deltic/dependency-injection": minor
---

Introduce type-safe service keys for compile-time dependency resolution safety.

**Breaking:**
- `resolve()` and `resolveLazy()` now require a `ServiceKey<Service>` instead of a plain string.
- `DependencyContainer` is now a default export instead of a named export.
- `register()` and `registerInstance()` now throw if a key is already registered.

**Added:**
- `ServiceKey<Service>` branded type for type-safe service resolution.
- `register()` and `registerInstance()` now return the `ServiceKey<Service>` for the registered service.
- `forgeServiceKey<Service>(key)` escape-hatch to create service keys without registering.
