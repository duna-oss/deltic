import type {DynamicMutex} from '@deltic/mutex';
import type {MessageConsumer} from './index.js';
import {LockingMessageConsumer} from './locking-message-consumer.js';
import {createMessage} from './helpers.js';

interface ExampleStream {
    aggregateRootId: string;
    messages: {
        example: {name: string};
    };
}

describe('LockingMessageConsumer', () => {
    test('it acquires and releases the lock around consumption', async () => {
        const calls: string[] = [];
        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {
                calls.push('consume');
            },
        };
        const mutex: DynamicMutex<string> = {
            async tryLock() {
                return true;
            },
            async lock(id: string) {
                calls.push(`lock:${id}`);
            },
            async unlock(id: string) {
                calls.push(`unlock:${id}`);
            },
        };

        const locking = new LockingMessageConsumer(consumer, mutex, {
            resolveLockId: (message) => String(message.headers.aggregate_root_id ?? 'unknown'),
        });

        const message = createMessage<ExampleStream>('example', {name: 'test'}, {aggregate_root_id: 'abc'});
        await locking.consume(message);

        expect(calls).toEqual(['lock:abc', 'consume', 'unlock:abc']);
    });

    test('it releases the lock when consumption fails', async () => {
        const calls: string[] = [];
        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {
                calls.push('consume');
                throw new Error('consumption failed');
            },
        };
        const mutex: DynamicMutex<string> = {
            async tryLock() {
                return true;
            },
            async lock(id: string) {
                calls.push(`lock:${id}`);
            },
            async unlock(id: string) {
                calls.push(`unlock:${id}`);
            },
        };

        const locking = new LockingMessageConsumer(consumer, mutex, {
            resolveLockId: (message) => String(message.headers.aggregate_root_id ?? 'unknown'),
        });

        const message = createMessage<ExampleStream>('example', {name: 'test'}, {aggregate_root_id: 'abc'});

        await expect(locking.consume(message)).rejects.toThrow('consumption failed');
        expect(calls).toEqual(['lock:abc', 'consume', 'unlock:abc']);
    });
});
