import {type AnyMessageFrom, type StreamDefinition} from './index.js';
import {CollectingMessageConsumer} from './collecting-consumer.js';
import {ConsumingMessageDispatcher} from './consuming-dispatcher.js';

enum ExampleTypes {
    First = 'first',
    Second = 'second',
}

interface ExampleStream extends StreamDefinition {
    topic: 'example',
    messages: {
        [ExampleTypes.First]: string,
        [ExampleTypes.Second]: number,
    },
}

test('SynchronousMessageProducer sends messages to consumers', async () => {
    const consumer = new CollectingMessageConsumer<ExampleStream>();
    const producer = new ConsumingMessageDispatcher<ExampleStream>([consumer]);
    const firstMessage: AnyMessageFrom<ExampleStream> = {headers: {}, type: ExampleTypes.First, payload: 'value'};

    await producer.send(firstMessage);
    const secondMessage: AnyMessageFrom<ExampleStream> = {headers: {}, type: ExampleTypes.Second, payload: 1234};
    await producer.send(secondMessage);

    const producedMessages = consumer.messages;
    expect(producedMessages).toContain(firstMessage);
    expect(producedMessages).toContain(secondMessage);
});
