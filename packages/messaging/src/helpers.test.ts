import {CollectingMessageDispatcher} from './collecting-message-dispatcher.js';
import {createMessageConsumer, createMessageDispatcher, messageWithHeader} from './helpers.js';
import {CollectingMessageConsumer} from './collecting-message-consumer.js';
import type {AnyMessageFrom, Message, StreamDefinition} from '@deltic/messaging';

interface ExampleStream extends StreamDefinition {
    messages: {
        example: string;
    };
}

const exampleMessage: AnyMessageFrom<ExampleStream> = {
    headers: {},
    type: 'example',
    payload: 'value',
};

describe('Messaging helper functions', () => {
    test('createMessageDispatcher creates a producer from a function', async () => {
        const actualProducer = new CollectingMessageDispatcher<ExampleStream>();
        const producer = createMessageDispatcher(
            actualProducer.send.bind(actualProducer) as typeof actualProducer.send,
        );
        const message: AnyMessageFrom<ExampleStream> = {
            payload: 'lol',
            headers: {},
            type: 'example',
        };
        await producer.send(message);
        expect(actualProducer.producedMessages()).toContain(message);
    });

    test('createMessageConsumer creates a consumer from a function', async () => {
        const actualConsumer = new CollectingMessageConsumer<ExampleStream>();
        const producer = createMessageConsumer<ExampleStream>(actualConsumer.consume.bind(actualConsumer));
        const message: AnyMessageFrom<ExampleStream> = {
            payload: 'lol',
            headers: {},
            type: 'example',
        };
        await producer.consume(message);
        expect(actualConsumer.messages).toContain(message);
    });

    describe('messageWithHeader', () => {
        test('messageWithHeader adds headers to a message', () => {
            const header = {key: 'something', value: 'value'};
            const message = messageWithHeader(exampleMessage, header);

            expect(message.headers?.something).toEqual('value');
        });

        test('containsMessage detects when messages are contains in a message array', () => {
            const messages: object[] = [exampleMessage];
            const otherMessage: Message<'type', 'other'> = {
                headers: {},
                type: 'type',
                payload: 'other',
            };
            expect(messages.includes(otherMessage)).toBe(false);
            expect(messages.includes(exampleMessage)).toBe(true);
        });
    });
});
