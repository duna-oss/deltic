import type {ContextData, Context} from '@deltic/context';
import type {MessageDecorator, MessageHeaders, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import {messageWithHeaders} from '@deltic/messaging/helpers';

export class ContextMessageDecorator<
    Stream extends StreamDefinition,
    C extends ContextData<C>,
> implements MessageDecorator<Stream> {
    constructor(
        private readonly context: Context<C>,
        private readonly keys: (keyof C & string)[],
    ) {}

    decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
        const headers = this.contextAsHeaders();

        return messages.map(m => messageWithHeaders(m, headers));
    }

    private contextAsHeaders(): MessageHeaders {
        const headers: Mutable<MessageHeaders> = {};
        const context: Partial<C> = this.context.context();

        for (const key of this.keys) {
            if (key in context) {
                headers[key] = context[key] as MessageHeaders[string];
            }
        }

        return headers;
    }
}

type Mutable<T> = {-readonly [P in keyof T]: T[P]};
