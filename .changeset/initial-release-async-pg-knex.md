---
"@deltic/async-pg-knex": minor
---

Initial release. Provides Knex query builder integration with `AsyncPgPool` for connection management:

- `AsyncKnexConnectionProvider` with lazy connections that only acquire a database connection when a query is awaited.
- Transaction support with `begin()`, `commit()`, `rollback()`, and `runInTransaction()`.
- Raw pg `Client` access via `claimClient()` and `releaseClient()`.
