import type {MessageDecorator, MessageDispatcher, MessagesFrom, StreamDefinition} from './index.js';

export class DecoratingMessageDispatcher<Stream extends StreamDefinition> implements MessageDispatcher<Stream> {
    constructor(
        private readonly dispatcher: MessageDispatcher<Stream>,
        private readonly decorator: MessageDecorator<Stream>,
    ) {}

    send(...messages: MessagesFrom<Stream>): Promise<void> {
        return this.dispatcher.send(...this.decorator.decorate(messages));
    }
}
