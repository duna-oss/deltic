---
"@deltic/service-dispatcher": patch
---

Add aggregate-aware service dispatching and mutex-based command locking.

- `AggregateServiceDispatcher` for service dispatchers that auto-fetch an aggregate root, delegate to a handler, and persist when events are recorded.
- `ServiceLocking` decorator to wrap any `Service` with mutex-based locking per command.
- `createServiceLockingMiddleware()` for the middleware variant of the same locking behavior.
- Shared locking types: `LockIDResolver`, `LockSkipDetector`, `ServiceLockingOptions`.
