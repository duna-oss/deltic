import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from './index.js';

export class MessageConsumerChain<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    private consumers: MessageConsumer<Stream>[] = [];

    constructor(...consumers: MessageConsumer<Stream>[]) {
        this.consumers = consumers;
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        await Promise.all(this.consumers.map(c => c.consume(message)));
    }
}
