import type {MessageDecorator, MessagesFrom, StreamDefinition} from './index.js';

export class MessageDecoratorChain<Stream extends StreamDefinition> implements MessageDecorator<Stream> {
    constructor(private readonly decorators: MessageDecorator<Stream>[]) {}

    decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
        for (const decorator of this.decorators) {
            messages = decorator.decorate(messages);
        }

        return messages;
    }
}
