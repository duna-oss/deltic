import {MessageRepositoryUsingMemory} from '@deltic/messaging/repository-using-memory';
import type {MessagesFrom} from '@deltic/messaging';
import {messageFactory} from '@deltic/messaging/helpers';
import {OffsetRepositoryUsingMemory} from '@deltic/offset-tracking/memory';
import {ExactlyOnceConsumerDecorator} from '@deltic/messaging/exactly-once-consumer-decorator';
import {KeyValueStoreUsingMemory} from '@deltic/key-value/memory';
import {ReducingMessageConsumer} from './reducing-message-consumer.js';

interface EventsForAutomaticRebuilds {
    topic: 'automatic-rebuilds',
    aggregateRoot: any,
    aggregateRootId: string,
    messages: {
        add: {
            amount: number,
        },
    },
}

describe('AutomaticRebuilds for single aggregate projections', () => {
    const createMessage = messageFactory<EventsForAutomaticRebuilds>();

    /**
     * In this scenario we store five messages. Four messages belong to the aggregate
     * we are going to rebuild. We dispatch the last message and expect the underlying
     * projection to catch up with the event-stream. We test this by incrementing a counter
     * with specific amounts and expect the resulting output to be the sum of all the amounts
     * from all the messages.
     */
    test('it can automatically rebuild projections', async () => {
        const messages = new MessageRepositoryUsingMemory<EventsForAutomaticRebuilds>();
        const projectionStore = new KeyValueStoreUsingMemory<string, number>();
        const rebuildingConsumer = new ExactlyOnceConsumerDecorator<EventsForAutomaticRebuilds>(
            new OffsetRepositoryUsingMemory(),
            new ReducingMessageConsumer<string, number, EventsForAutomaticRebuilds>(
                projectionStore,
                message => `example:${message.headers['aggregate_root_id']}`,
                () => 0,
                (state, payload) => state + payload.payload.amount,
            ),
            messages,
        );
        const storedMessages: MessagesFrom<EventsForAutomaticRebuilds> = [
            ...[25, 15, 10, 50].map((amount, index) => createMessage('add', {
                amount,
            }, {
                aggregate_root_version: index + 1,
                aggregate_root_id: '1234',
            })),
            // ⬇️ not matching the main aggregate ID on purpose
            createMessage('add', {
                amount: 15,
            }, {
                aggregate_root_version: 1,
                aggregate_root_id: '4321',
            }),
        ];

        for (const message of storedMessages) {
            await messages.persist(String(message.headers['aggregate_root_id']), [message]);
        }

        await rebuildingConsumer.consume(storedMessages[3]);

        const total = await projectionStore.retrieve('example:1234');

        expect(total).toEqual(100);
    });
});