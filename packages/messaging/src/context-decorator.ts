import type {ContextData, Context} from '@deltic/context';
import type {MessageDecorator, MessageHeaders, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import {messageWithHeaders} from '@deltic/messaging/helpers';

export class ContextMessageDecorator<
    Stream extends StreamDefinition,
    C extends ContextData<C>
> implements MessageDecorator<Stream> {
    constructor(
        private readonly context: Context<C>,
    ) {
    }

    decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
        return messages.map(m => messageWithHeaders(
            m,
            this.contextAsHeaders(),
        ));
    }

    private contextAsHeaders(): MessageHeaders {
        const headers: Mutable<MessageHeaders> = {};
        const context: Partial<C> = this.context.context();

        for (const key in context) {
            headers[key] = context[key];
        }

        return headers;
    }
}

type Mutable<T> = {-readonly [P in keyof T]: T[P]};
