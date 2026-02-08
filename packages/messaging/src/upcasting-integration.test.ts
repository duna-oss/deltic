import {
    SchemaVersionMessageDecorator,
    UpcastingMessageRepository,
    UpcastingOutboxRepository,
    VersionedMessageConsumer,
} from './upcasting.js';
import {CollectingMessageConsumer} from './collecting-message-consumer.js';
import {MessageRepositoryUsingMemory} from './message-repository-using-memory.js';
import {OutboxRepositoryUsingMemory} from './outbox.js';
import type {AnyMessageFrom} from './index.js';
import {collect} from './helpers.js';
import {
    type TestVersionedStream,
    testUpcasters,
    makeUserCreatedV1,
    makeUserCreatedV2,
    makeUserCreatedV3,
    makeUserDeleted,
} from './upcasting.stubs.js';

describe('Upcasting Integration', () => {
    test('full write-read cycle with schema evolution', async () => {
        // This test simulates the complete lifecycle:
        // 1. Write messages with SchemaVersionMessageDecorator (sets schema_version)
        // 2. Store in repository
        // 3. Read back with UpcastingMessageRepository (upcasts to current version)

        // arrange
        const innerRepository = new MessageRepositoryUsingMemory<TestVersionedStream>();
        const decorator = new SchemaVersionMessageDecorator<TestVersionedStream>(testUpcasters);
        const upcastingRepository = new UpcastingMessageRepository<TestVersionedStream>(
            testUpcasters,
            innerRepository,
        );

        const id = 'user-aggregate-1';

        // Simulate writing a current-version message
        const newMessage = makeUserCreatedV3('newuser', 'newuser@test.com', 35);
        const decoratedMessages = decorator.decorate([newMessage]);

        // act - persist the decorated message
        await innerRepository.persist(id, decoratedMessages);

        // Simulate a legacy V1 message that was stored before upcasting existed
        // (directly stored without going through decorator - schema_version=0)
        const legacyMessage = makeUserCreatedV1('legacyuser', 0);
        await innerRepository.persist(id, [legacyMessage]);

        // Read all messages through upcasting repository
        const retrieved = await collect(upcastingRepository.retrieveAllForAggregate(id));

        // assert
        expect(retrieved).toHaveLength(2);

        // New message should be unchanged (already at version 2)
        expect(retrieved[0].payload).toEqual({
            username: 'newuser',
            email: 'newuser@test.com',
            age: 35,
        });

        // Legacy message should be upcasted
        expect(retrieved[1].payload).toEqual({
            username: 'legacyuser',
            email: 'legacyuser@example.com', // Added by upcaster
            age: 0, // Added by upcaster
        });
    });

    test('consumer pipeline with mixed version messages', async () => {
        // arrange
        const collector = new CollectingMessageConsumer<TestVersionedStream>();
        const versionedConsumer = new VersionedMessageConsumer<TestVersionedStream>(
            testUpcasters,
            collector,
        );

        const messages: AnyMessageFrom<TestVersionedStream>[] = [
            makeUserCreatedV1('v1user', 0), // V1 message
            makeUserCreatedV2('v2user', 'v2@test.com', 1), // V2 message
            makeUserCreatedV3('v3user', 'v3@test.com', 30, 2), // V3 message (current)
            makeUserDeleted('deleted-user'), // Non-versioned message
        ];

        // act
        for (const message of messages) {
            await versionedConsumer.consume(message);
        }

        // assert
        expect(collector.messages).toHaveLength(4);

        // V1 -> V3: both transformations applied
        expect(collector.messages[0].payload).toEqual({
            username: 'v1user',
            email: 'v1user@example.com',
            age: 0,
        });

        // V2 -> V3: only second transformation applied
        expect(collector.messages[1].payload).toEqual({
            username: 'v2user',
            email: 'v2@test.com',
            age: 0,
        });

        // V3 -> V3: no transformation
        expect(collector.messages[2].payload).toEqual({
            username: 'v3user',
            email: 'v3@test.com',
            age: 30,
        });

        // Non-versioned: passed through unchanged
        expect(collector.messages[3].payload).toEqual({
            userId: 'deleted-user',
        });
    });

    test('outbox relay with upcasting', async () => {
        // This test simulates the outbox pattern with upcasting:
        // Messages stored in outbox -> retrieved with upcasting -> relayed to consumer

        // arrange
        const innerOutbox = new OutboxRepositoryUsingMemory<TestVersionedStream>();
        const upcastingOutbox = new UpcastingOutboxRepository<TestVersionedStream>(
            testUpcasters,
            innerOutbox,
        );
        const collector = new CollectingMessageConsumer<TestVersionedStream>();

        // Store legacy messages in outbox (simulating old data)
        await innerOutbox.persist([
            makeUserCreatedV1('outbox-user', 0),
        ]);

        // act - retrieve through upcasting outbox and consume
        for await (const message of upcastingOutbox.retrieveBatch(10)) {
            await collector.consume(message);
        }

        // assert
        expect(collector.messages).toHaveLength(1);
        expect(collector.messages[0].payload).toEqual({
            username: 'outbox-user',
            email: 'outbox-user@example.com',
            age: 0,
        });
    });
});
