import type {AnyMessageFrom, MessageConsumer, MessageDispatcher, StreamDefinition} from './index.js';

export class DispatchingMessageConsumer<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    constructor(
        private readonly dispatcher: MessageDispatcher<Stream>,
    ) {
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        await this.dispatcher.send(message);
    }
}
