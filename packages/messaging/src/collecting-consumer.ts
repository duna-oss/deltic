import type {AnyMessageFrom, MessageConsumer, MessagesFrom, StreamDefinition} from './index.js';

export class CollectingMessageConsumer<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    public readonly messages: MessagesFrom<Stream> = [];

    constructor(
    ) {
    }

    public clear(): void {
        while (this.messages.length > 0) {
            this.messages.pop();
        }
    }

    public isEmpty(): boolean {
        return this.messages.length === 0;
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        this.messages.push(message);
    }
}
