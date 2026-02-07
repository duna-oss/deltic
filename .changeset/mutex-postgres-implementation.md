---
"@deltic/mutex": patch
---

Add PostgreSQL advisory lock implementation and CRC32 lock ID converter.

- `MutexUsingPostgres` for distributed locking via PostgreSQL advisory locks, supporting `fresh` and `primary` connection modes.
- `Crc32LockIdConverter` for mapping string lock IDs to numeric advisory lock IDs using CRC32 with a configurable `LockRange`.
- `makePostgresMutex()` factory for convenient construction with automatic in-memory guard for `primary` mode.
- `ConnectionStorageProvider` abstraction with `StaticConnectionStorageProvider` and `AsyncConnectionStorageProvider` implementations.
