import {type AnyMessageFrom, type StreamDefinition} from './index.js';
import {CollectingMessageConsumer} from './collecting-message-consumer.js';

interface ExampleStream extends StreamDefinition {
    topic: 'example';
    messages: {
        ['example']: string;
    };
}

const create = (payload: string): AnyMessageFrom<ExampleStream> => ({
    headers: {},
    type: 'example',
    payload,
});

describe('InMemoryMessageConsumer', () => {
    test('it collects messages it consumes', async () => {
        const consumer = new CollectingMessageConsumer<ExampleStream>();
        const message = create('value');
        await consumer.consume(message);
        expect(consumer.messages).toContain(message);
    });

    test("it tells if it's empty or not", () => {
        const consumer = new CollectingMessageConsumer<ExampleStream>();
        expect(consumer.isEmpty()).toBe(true);
        consumer.consume(create('example'));
        expect(consumer.isEmpty()).toBe(false);
    });

    test('it can clear itself', () => {
        const consumer = new CollectingMessageConsumer<ExampleStream>();
        expect(consumer.isEmpty()).toBe(true);
        consumer.consume(create('example'));
        expect(consumer.isEmpty()).toBe(false);
        consumer.clear();
        expect(consumer.isEmpty()).toBe(true);
    });
});
