---
"@deltic/messaging": minor
---

Initial release. Provides a messaging framework including:

- `MessageRepository` interface with PostgreSQL implementation for event stream persistence.
- `MessageDispatcher` and `MessageConsumer` interfaces with chain, decorator, and collecting implementations.
- Transactional outbox pattern via `OutboxRepository` and `OutboxMessageDispatcher`.
- Message upcasting support for versioned stream evolution.
- AMQP (RabbitMQ) integration: `AMQPConnectionProvider`, `AMQPChannelPool`, `AMQPMessageDispatcher`, `AMQPMessageRelay`.
- `MessageDeliveryCounter` interface with in-memory implementation for tracking delivery attempts.
