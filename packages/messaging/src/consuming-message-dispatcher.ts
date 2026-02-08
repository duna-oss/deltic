import type {MessageConsumer, MessageDispatcher, MessagesFrom, StreamDefinition} from './index.js';

export class ConsumingMessageDispatcher<Stream extends StreamDefinition> implements MessageDispatcher<Stream> {
    constructor(private readonly consumers: MessageConsumer<Stream>[] = []) {}
    async send(...messages: MessagesFrom<Stream>): Promise<void> {
        for await (const consumer of this.consumers) {
            for await (const message of messages) {
                await consumer.consume(message);
            }
        }
    }
}
