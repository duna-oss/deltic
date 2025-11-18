import {DecoratingMessageDispatcher} from './decorating-dispatcher.js';
import {CollectingMessageDispatcher} from './collecting-dispatcher.js';
import {messageFactory, messageWithHeader} from './helpers.js';

type ExampleStream = {
    aggregateRootId: string,
    messages: {
        example: string,
    },
};

describe('DecoratingMessageDispatcher', () => {
    const createMessage = messageFactory<ExampleStream>();

    test('it decorated messages and forwards them to an inner dispatcher', async () => {
        const inner = new CollectingMessageDispatcher<ExampleStream>();
        let index = 0;
        const dispatcher = new DecoratingMessageDispatcher<ExampleStream>(
            inner,
            {
                decorate: (messages) =>
                    messages.map(m => messageWithHeader(m, {
                        key: 'index',
                        value: (++index).toString(),
                    })),
            },
        );

        await dispatcher.send(
            createMessage('example', 'example1'),
            createMessage('example', 'example2'),
        );

        expect(inner.producedMessages()[0].headers['index']).toEqual('1');
        expect(inner.producedMessages()[1].headers['index']).toEqual('2');
    });
});
