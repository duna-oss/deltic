import {DecoratingMessageConsumer} from './decorating-consumer.js';
import {CollectingMessageConsumer} from './collecting-consumer.js';
import {type MessageDecorator} from './index.js';
import {GlobalClock} from '@deltic/clock';
import {createMessage, messageWithHeader} from './helpers.js';

interface ExampleStream {
    topic: 'example',
    aggregateRootId: string,
    messages: {
        example: {
            value: string,
        },
    },
}

describe('DecoratingMessageConsumer', () => {
    test('it decorates messages', async () => {
        const decorator: MessageDecorator<ExampleStream> = {
            decorate(messages) {
                return messages.map(m => messageWithHeader(m, {
                    key: 'decorated',
                    value: true,
                }));
            },
        };

        const innerConsumer = new CollectingMessageConsumer<ExampleStream>();
        const consumer = new DecoratingMessageConsumer<ExampleStream>(decorator, innerConsumer);
        const now = GlobalClock.date();
        await consumer.consume(createMessage<ExampleStream>(
            'example',
            {
                value: 'string',
            },
            {
                aggregate_root_id: 'lol',
                aggregate_root_version: 0,
                time_of_recording: now.toISOString(),
                time_of_recording_ms: now.getTime(),
            }
        ));

        expect(innerConsumer.messages).toEqual([
            createMessage<ExampleStream>(
                'example',
                {
                    value: 'string',
                },
                {
                    aggregate_root_id: 'lol',
                    aggregate_root_version: 0,
                    time_of_recording: now.toISOString(),
                    time_of_recording_ms: now.getTime(),
                    decorated: true,
                }
            ),
        ]);
    });
});
