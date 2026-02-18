import {UpcastingOutboxRepository} from './upcasting.js';
import {OutboxRepositoryUsingMemory} from './outbox.js';
import type {MessagesFrom} from './index.js';
import {collect} from './helpers.js';
import {
    type TestVersionedStream,
    testUpcasters,
    makeUserCreatedV1,
    makeUserCreatedV2,
    makeUserDeleted,
} from './upcasting.stubs.js';

describe('UpcastingOutboxRepository', () => {
    let innerOutbox: OutboxRepositoryUsingMemory<TestVersionedStream>;
    let outbox: UpcastingOutboxRepository<TestVersionedStream>;

    beforeEach(() => {
        innerOutbox = new OutboxRepositoryUsingMemory();
        outbox = new UpcastingOutboxRepository(testUpcasters, innerOutbox);
    });

    describe('persist', () => {
        test('passes messages through to inner outbox unchanged', async () => {
            // arrange
            const messages: MessagesFrom<TestVersionedStream> = [
                makeUserCreatedV1('alice', 0),
            ];

            // act
            await outbox.persist(messages);

            // assert
            expect(await innerOutbox.numberOfPendingMessages()).toBe(1);
        });
    });

    describe('retrieveBatch', () => {
        test('upcasts messages when retrieving batch', async () => {
            // arrange
            await innerOutbox.persist([
                makeUserCreatedV1('john', 0),
                makeUserCreatedV2('jane', 'jane@test.com', 1),
                makeUserDeleted('user-1'),
            ]);

            // act
            const retrieved = await collect(outbox.retrieveBatch(10));

            // assert
            expect(retrieved).toHaveLength(3);
            expect(retrieved[0].payload).toEqual({
                username: 'john',
                email: 'john@example.com',
                age: 0,
            });
            expect(retrieved[1].payload).toEqual({
                username: 'jane',
                email: 'jane@test.com',
                age: 0,
            });
            expect(retrieved[2].payload).toEqual({userId: 'user-1'});
        });

        test('respects batch size limit', async () => {
            // arrange
            await innerOutbox.persist([
                makeUserCreatedV1('a', 0),
                makeUserCreatedV1('b', 0),
                makeUserCreatedV1('c', 0),
            ]);

            // act
            const retrieved = await collect(outbox.retrieveBatch(2));

            // assert
            expect(retrieved).toHaveLength(2);
        });
    });

    describe('markConsumed', () => {
        test('passes through to inner outbox', async () => {
            // arrange
            await innerOutbox.persist([makeUserDeleted('user-1')]);
            const messages = await collect(innerOutbox.retrieveBatch(10));

            // act
            await outbox.markConsumed(messages);

            // assert
            expect(await innerOutbox.numberOfConsumedMessages()).toBe(1);
            expect(await innerOutbox.numberOfPendingMessages()).toBe(0);
        });
    });

    describe('cleanupConsumedMessages', () => {
        test('passes through to inner outbox', async () => {
            // arrange
            await innerOutbox.persist([makeUserDeleted('user-1')]);
            const messages = await collect(innerOutbox.retrieveBatch(10));
            await innerOutbox.markConsumed(messages);

            // act
            const cleaned = await outbox.cleanupConsumedMessages(10);

            // assert
            expect(cleaned).toBe(1);
        });
    });

    describe('numberOfPendingMessages', () => {
        test('passes through to inner outbox', async () => {
            // arrange
            await innerOutbox.persist([makeUserDeleted('user-1'), makeUserDeleted('user-2')]);

            // act & assert
            expect(await outbox.numberOfPendingMessages()).toBe(2);
        });
    });

    describe('numberOfConsumedMessages', () => {
        test('passes through to inner outbox', async () => {
            // arrange
            await innerOutbox.persist([makeUserDeleted('user-1')]);
            const messages = await collect(innerOutbox.retrieveBatch(10));
            await innerOutbox.markConsumed(messages);

            // act & assert
            expect(await outbox.numberOfConsumedMessages()).toBe(1);
        });
    });

    describe('truncate', () => {
        test('passes through to inner outbox', async () => {
            // arrange
            await innerOutbox.persist([makeUserDeleted('user-1')]);

            // act
            await outbox.truncate();

            // assert
            expect(await innerOutbox.numberOfPendingMessages()).toBe(0);
        });
    });
});
