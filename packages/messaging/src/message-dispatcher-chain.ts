import type {MessageDispatcher, MessagesFrom, StreamDefinition} from './index.js';

export class MessageDispatcherChain<Stream extends StreamDefinition> implements MessageDispatcher<Stream> {
    private dispatchers: MessageDispatcher<Stream>[] = [];

    constructor(...dispatchers: MessageDispatcher<Stream>[]) {
        this.dispatchers = dispatchers;
    }

    async send(...messages: MessagesFrom<Stream>): Promise<void> {
        await Promise.all(this.dispatchers.map(c => c.send(...messages)));
    }
}
