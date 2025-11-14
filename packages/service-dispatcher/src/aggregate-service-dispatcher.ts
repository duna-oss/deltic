import type {Service, ServiceStructure} from './index.js';
import type {AggregateRepository, AggregateStream} from '@deltic/event-sourcing';

export * from './index.js';

type BusHandlerWithAggregate<
    Definition extends ServiceStructure<Definition>,
    Stream extends AggregateStream<Stream>,
> = {
    readonly [T in keyof Definition]: (aggregate: Stream['aggregateRoot'], input: Definition[T]['payload']) => Promise<Definition[T]['response']> | Definition[T]['response']
};

export type AggregateRootIdResolver<
    Definition extends ServiceStructure<Definition>,
    Result,
> = <T extends keyof Definition>(command: Definition[T]['payload']) => Result;

export class AggregateServiceDispatcher<
    Definition extends ServiceStructure<Definition>,
    Stream extends AggregateStream<Stream>,
> implements Service<Definition> {
    constructor(
        private handlers: BusHandlerWithAggregate<Definition, Stream>,
        private repository: AggregateRepository<Stream>,
        private findAggregateId: AggregateRootIdResolver<Definition, Stream['aggregateRootId']>,
    ) {}

    async handle<T extends keyof Definition>(type: T, payload: Definition[T]['payload']): Promise<Definition[T]['response']> {
        const handler = this.handlers[type];
        const aggregate = await this.repository.retrieve(this.findAggregateId(payload));

        try {
            return await (handler)(aggregate as any, payload);
        } finally {
            if (aggregate.peekEvents().length > 0) {
                await this.repository.persist(aggregate);
            }
        }
    }
}
