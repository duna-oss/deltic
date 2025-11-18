# `@deltic/async-pg-pool`

Deltic's Asynchronous Postgres Pool is an opinionated to access connections from a `pg` pool. It is designed
around the following goals:

- **Facilitate tenant isolation**<br/>
  The async pool provides lifecycle callback to safely set (and remove) tenant-specific
  context. Elegantly pairs with Row Level Security (RLS) policies.
- **Share transactions through AsyncLocalStorage**<br/>
  Facilitate cross-component transactions by sharing transactions via AsyncLocalStorage.
  Keep your domain model free of infrastructure concerns.
- **Share a primary connection**<br/>
  Sharing a primary connection facilitates advanced consistency use-cases. For example;
  using advisory locks should be done using a dedicated connection to prevent out of
  lock operations.

The async pg pool is used by many Deltic packages to ensure transactional operations.
Examples are:

- Storing new event for an events-sourced aggregate root in the message and outbox
  repositories is done in a single atomic transaction.
- The `pg` implementation of `@deltic/mutex` uses the primary database connection to
  to prevent "out of lock" operations.
- The `@deltic/aggregate-projections` package stores the projection in the same
  database transaction used for storing the message/events.