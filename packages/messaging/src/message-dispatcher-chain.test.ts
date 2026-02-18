import {CollectingMessageDispatcher} from './collecting-message-dispatcher.js';
import type {MessagesFrom} from './index.js';
import {MessageDispatcherChain} from './message-dispatcher-chain.js';

describe('MessageDispatcherChain', () => {
    let dispatcher: MessageDispatcherChain<any>;
    let delegate1: CollectingMessageDispatcher<any>;
    let delegate2: CollectingMessageDispatcher<any>;
    const messages: MessagesFrom<any> = [
        {type: 'any', payload: 'first', headers: {}},
        {type: 'any', payload: 'second', headers: {}},
    ];

    beforeEach(() => {
        // arrange
        delegate1 = new CollectingMessageDispatcher();
        delegate2 = new CollectingMessageDispatcher();
        dispatcher = new MessageDispatcherChain(delegate1, delegate2);
    });

    test('dispatched messages are delegated', async () => {
        // act
        await dispatcher.send(...messages);

        // assert
        expect(delegate1.dispatchCount).toEqual(1);
        expect(delegate1.producedMessages()).toEqual(messages);
        expect(delegate2.dispatchCount).toEqual(1);
        expect(delegate2.producedMessages()).toEqual(messages);
    });
});
