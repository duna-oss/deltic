---
"@deltic/event-sourcing": minor
---

Initial release. Provides a full event sourcing framework including:

- `AggregateRoot` base class with event recording and replay.
- `EventSourcedAggregateRepository` for persisting and retrieving aggregates from event streams.
- `AggregateRootUsingReflectMetadata` for decorator-based event handler registration.
- Snapshotting support via `AggregateRootRepositoryWithSnapshotting` and `SnapshotRepository`.
- Test tooling with `createTestTooling()` for given/when/then-style aggregate testing.
