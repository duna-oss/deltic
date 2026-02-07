---
"@deltic/async-pg-pool": minor
---

Add transaction lifecycle helpers and remove HTTP middleware.

**Breaking:**
- Removed `httpMiddleware()` method. HTTP middleware should be implemented externally.

**Added:**
- `inTransaction()` to check if currently inside a transaction.
- `withTransaction()` to retrieve the active transaction connection (throws if none active).
- `runInTransaction(fn)` to run a function inside a transaction with automatic commit/rollback.
- `TransactionManagerUsingPg` class implementing the `TransactionManager` interface.
- `UnableToProvideActiveTransaction` error class.
