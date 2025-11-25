# `@deltic/async-pg-pool`



Deltic's Asynchronous Postgres Pool is an opinionated to access connections from a `pg` pool. It is designed
around the following goals:

- **Isolated Multi-Tenancy**<br/>
  Ensure multi-tenant applications can operate safely. Ensure tenant context can not be
  leaked through database sessions, while still exploiting the benefit of session-bound
  context.
- **Predictable Connection Re-use**<br/>
  Not every database connection is created equal. The primary connection can be re-used
  for various use-cases; reliable advisory locks with protection against out of lock
  operations, and shared transactions for atomic operations across infrastructural
  boundaries. Keep your domain model free of infrastructure concerns.
- **Reliable Tenant Isolation**<br/>
  The async pool provides lifecycle callback to safely manage tenant-specific information
  context, guarded against leaking context across requests. Elegantly pairs with Row Level
  Security (RLS) policies.

The async pg pool is used by many Deltic packages to ensure transactional operations.
Examples are:

- Storing new event for an events-sourced aggregate root in the message and outbox
  repositories is done in a single atomic transaction.
- The `pg` implementation of `@deltic/mutex` uses the primary database connection to
  to prevent "out of lock" operations.
- The `@deltic/aggregate-projections` package stores the projection in the same
  database transaction used for storing the message/events.
- The `@deltic/key-value` package use storage that is the projection in the same
  database transaction used for storing the message/events.