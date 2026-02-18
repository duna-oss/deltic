import type {MessageConsumer, MessageDispatcher, MessagesFrom, StreamDefinition} from './index.js';

export class CollectingMessageDispatcher<Stream extends StreamDefinition> implements MessageDispatcher<Stream> {
    private messages: MessagesFrom<Stream> = [];
    private numberOfDispatches = 0;

    constructor(private readonly consumersToRelayTo: MessageConsumer<Stream>[] = []) {}

    public clear(): void {
        this.messages = [];
    }

    public isEmpty(): boolean {
        return this.messages.length === 0;
    }

    public producedMessages(): MessagesFrom<Stream> {
        return this.messages;
    }

    async send(...messages: MessagesFrom<Stream>): Promise<void> {
        ++this.numberOfDispatches;
        this.messages.push(...messages);
        for await (const consumer of this.consumersToRelayTo) {
            for await (const message of messages) {
                await consumer.consume(message);
            }
        }
    }

    get dispatchCount(): number {
        return this.numberOfDispatches;
    }
}
