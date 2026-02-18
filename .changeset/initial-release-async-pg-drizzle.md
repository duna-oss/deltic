---
"@deltic/async-pg-drizzle": minor
---

Initial release. Provides a Drizzzle query builder integration with `AsyncPgPool` for connection management:

- `AsyncDrizzleConnectionProvider` with lazy connections that only acquire a database connection when a query is awaited.
- Transaction support with `begin()`, `commit()`, `rollback()`, and `runInTransaction()`.
