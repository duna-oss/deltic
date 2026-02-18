import type {Context, ContextData} from '@deltic/context';
import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from './index.js';

export type ContextResolver<Stream extends StreamDefinition, C extends ContextData<C>> = (
    message: AnyMessageFrom<Stream>,
) => Partial<C> | Promise<Partial<C>>;

export class RunMessageConsumerInContext<
    Stream extends StreamDefinition,
    C extends ContextData<C>,
> implements MessageConsumer<Stream> {
    constructor(
        private readonly consumer: MessageConsumer<Stream>,
        private readonly context: Context<C>,
        private readonly resolveContext: ContextResolver<Stream, C>,
    ) {}

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        const contextValues = await this.resolveContext(message);

        await this.context.run(
            () => this.consumer.consume(message),
            contextValues,
        );
    }
}
