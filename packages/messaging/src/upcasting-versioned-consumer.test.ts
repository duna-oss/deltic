import {VersionedMessageConsumer} from './upcasting.js';
import {CollectingMessageConsumer} from './collecting-message-consumer.js';
import {
    type TestVersionedStream,
    testUpcasters,
    makeUserCreatedV1,
    makeUserCreatedV2,
    makeUserCreatedV3,
    makeUserDeleted,
} from './upcasting.stubs.js';

describe('VersionedMessageConsumer', () => {
    let innerConsumer: CollectingMessageConsumer<TestVersionedStream>;
    let consumer: VersionedMessageConsumer<TestVersionedStream>;

    beforeEach(() => {
        innerConsumer = new CollectingMessageConsumer();
        consumer = new VersionedMessageConsumer(testUpcasters, innerConsumer);
    });

    test('upcasts message from V1 (schema_version=0) to V3', async () => {
        // arrange
        const message = makeUserCreatedV1('john', 0);

        // act
        await consumer.consume(message);

        // assert
        expect(innerConsumer.messages).toHaveLength(1);
        const consumed = innerConsumer.messages[0];
        expect(consumed.type).toBe('user_created');
        expect(consumed.payload).toEqual({
            username: 'john',
            email: 'john@example.com', // Added by V1->V2 upcaster
            age: 0, // Added by V2->V3 upcaster
        });
    });

    test('upcasts message from V2 (schema_version=1) to V3', async () => {
        // arrange
        const message = makeUserCreatedV2('jane', 'jane@custom.com', 1);

        // act
        await consumer.consume(message);

        // assert
        expect(innerConsumer.messages).toHaveLength(1);
        const consumed = innerConsumer.messages[0];
        expect(consumed.payload).toEqual({
            username: 'jane',
            email: 'jane@custom.com', // Preserved from V2
            age: 0, // Added by V2->V3 upcaster
        });
    });

    test('passes through message already at current version (schema_version=2)', async () => {
        // arrange
        const message = makeUserCreatedV3('bob', 'bob@test.com', 42, 2);

        // act
        await consumer.consume(message);

        // assert
        expect(innerConsumer.messages).toHaveLength(1);
        const consumed = innerConsumer.messages[0];
        expect(consumed.payload).toEqual({
            username: 'bob',
            email: 'bob@test.com',
            age: 42,
        });
    });

    test('treats missing schema_version as version 0', async () => {
        // arrange - no schema_version header
        const message = makeUserCreatedV1('legacy');

        // act
        await consumer.consume(message);

        // assert
        const consumed = innerConsumer.messages[0];
        expect(consumed.payload).toEqual({
            username: 'legacy',
            email: 'legacy@example.com',
            age: 0,
        });
    });

    test('passes through non-versioned messages unchanged', async () => {
        // arrange
        const message = makeUserDeleted('user-789');

        // act
        await consumer.consume(message);

        // assert
        expect(innerConsumer.messages).toHaveLength(1);
        expect(innerConsumer.messages[0]).toEqual(message);
    });
});
