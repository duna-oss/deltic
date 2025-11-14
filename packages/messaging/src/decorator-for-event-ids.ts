import type {MessageDecorator, MessagesFrom, StreamDefinition} from './index.js';

import {messageWithHeader} from './helpers.js';

export class MessageDecoratorForEventIds<Stream extends StreamDefinition = StreamDefinition> implements MessageDecorator<Stream> {
    constructor(
        private readonly idGenerator: () => number | string,
    ) {
    }

    decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
        return messages.map(message => message.headers['event_id'] === undefined
            ? messageWithHeader(message, {
                key: 'event_id',
                value: this.idGenerator(),
            })
            : message);
    }
}
