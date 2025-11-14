import type {AnyMessageFrom, MessageConsumer, MessageDecorator, StreamDefinition} from './index.js';

export class DecoratingMessageConsumer<
    Stream extends StreamDefinition,
> implements MessageConsumer<Stream> {
    constructor(
        private readonly decorator: MessageDecorator<Stream>,
        private readonly consumer: MessageConsumer<Stream>,
    ) {
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        await this.consumer.consume(this.decorator.decorate([message])[0]);
    }
}
