import {type AnyMessageFrom, type StreamDefinition} from './index.js';
import {CollectingMessageDispatcher} from './collecting-dispatcher.js';

interface ExampleStream extends StreamDefinition {
    topic: 'example',
    messages: {
        example: string,
    },
}

const create = (payload: string): AnyMessageFrom<ExampleStream> => ({headers: {}, type: 'example', payload});

describe('InMemoryMessageDispatcher', () => {
    test('it collects messages it produces', async () => {
        const producer = new CollectingMessageDispatcher<ExampleStream>();
        const message = create('value');
        await producer.send(message);
        expect(producer.producedMessages()).toContain(message);
    });

    test("it tells if it's empty or not", async () => {
        const producer = new CollectingMessageDispatcher<ExampleStream>();
        expect(producer.isEmpty()).toBe(true);
        await producer.send(create('example'));
        expect(producer.isEmpty()).toBe(false);
    });

    test('it can clear itself', async () => {
        const producer = new CollectingMessageDispatcher<ExampleStream>();
        expect(producer.isEmpty()).toBe(true);
        await producer.send(create('example'));
        expect(producer.isEmpty()).toBe(false);
        producer.clear();
        expect(producer.isEmpty()).toBe(true);
    });
});
