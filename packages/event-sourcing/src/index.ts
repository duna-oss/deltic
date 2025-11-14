import 'reflect-metadata';
import type {
    AdditionalMessageHeaders,
    AnyMessageFrom,
    AnyMessageTypeFromStream,
    MessageDecorator,
    MessageDispatcher,
    MessageRepository,
    MessagesFrom,
    StreamDefinition,
} from '@deltic/messaging';
import {type Clock, GlobalClock} from '@deltic/clock';
import {TransactionManager} from '@deltic/transaction-manager';

export interface AggregateStream<Stream extends AggregateStream<Stream>> extends StreamDefinition {
    aggregateRoot: AggregateRoot<Stream>,
}

export interface AggregateRoot<Stream extends AggregateStream<Stream>> {
    releaseEvents(): MessagesFrom<Stream>,

    peekEvents(): MessagesFrom<Stream>,

    aggregateRootVersion(): number,

    readonly aggregateRootId: Stream['aggregateRootId'],
}

export interface AggregateRootFactory<Stream extends AggregateStream<Stream>> {
    reconstituteFromEvents(id: Stream['aggregateRootId'], events: AsyncGenerator<AnyMessageFrom<Stream>>): Promise<Stream['aggregateRoot']>,
}

export interface AggregateRepository<
    Stream extends AggregateStream<Stream>,
> {
    retrieve(id: Stream['aggregateRootId']): Promise<Stream['aggregateRoot']>,
    retrieveAtVersion(id: Stream['aggregateRootId'], version: number): Promise<Stream['aggregateRoot']>,
    persist(aggregateRoot: Stream['aggregateRoot']): Promise<void>,
}

export class EventSourcedAggregateRepository<
    Stream extends AggregateStream<Stream>,
> implements AggregateRepository<Stream> {
    constructor(
        protected readonly factory: AggregateRootFactory<Stream>,
        protected readonly messageRepository: MessageRepository<Stream>,
        protected readonly messageDispatcher: MessageDispatcher<Stream> | undefined = undefined,
        protected readonly messageDecorator: MessageDecorator<Stream> = {decorate: (messages) => messages},
        protected readonly transactionManager: TransactionManager,
    ) {
    }

    async retrieve(id: Stream['aggregateRootId']): Promise<Stream['aggregateRoot']> {
        return this.factory.reconstituteFromEvents(id, this.messageRepository.retrieveAllForAggregate(id));
    }

    async retrieveAtVersion(id: Stream['aggregateRootId'], version: number): Promise<Stream['aggregateRoot']> {
        return this.factory.reconstituteFromEvents(id, this.messageRepository.retrieveAllUntilVersion(id, version + 1));
    }

    async persist(aggregateRoot: Stream['aggregateRoot']): Promise<void> {
        const recordedEvents = aggregateRoot.releaseEvents();

        if (recordedEvents.length === 0) {
            return;
        }

        const messages = this.messageDecorator.decorate(recordedEvents);
        const alreadyInTransaction = this.transactionManager.inTransaction();

        if (!alreadyInTransaction) {
            await this.transactionManager.begin();
        }

        try {
            await this.messageRepository.persist(aggregateRoot.aggregateRootId, messages);
            await this.messageDispatcher?.send(...messages);
        } catch (e) {
            if (!alreadyInTransaction) {
                await this.transactionManager.abort();
            }
            throw e;
        }

        if (!alreadyInTransaction) {
            await this.transactionManager.commit();
        }
    }
}

const eventHandlerMetadataKey = Symbol.for('deltic:event-sourcing:event-handler');

type MessageType = string;
type KeyType = string | symbol;
export type EventHandlerMap = Map<MessageType, KeyType[]>;

export const makeEventHandler = (metaKey: symbol): DecoratedHandler => <T extends MessageType>(messageType: T): MethodDecorator => {
    return (aggregateRoot: object, key: KeyType) => {
        const metadata: EventHandlerMap = Reflect.getMetadata(metaKey, aggregateRoot) || new Map();
        const handlers = metadata.get(messageType) ?? [];
        handlers.push(key);
        metadata.set(messageType, handlers);
        Reflect.defineMetadata(metaKey, metadata, aggregateRoot);
    };
};

export interface DecoratedHandler {
    <T extends MessageType>(messageType: T): MethodDecorator,
}

export const EventHandler = makeEventHandler(eventHandlerMetadataKey);

export function createHandlerLookupTable(target: object, metaKey: symbol = eventHandlerMetadataKey) {
    return Reflect.getMetadata(metaKey, target) || new Map();
}

export type AggregateRootOptions = {
    clock?: Clock,
};

export abstract class AggregateRootBehavior<Stream extends AggregateStream<Stream>> implements AggregateRoot<Stream> {
    private readonly _clock: Clock;
    readonly aggregateRootId: Stream['aggregateRootId'];
    private recordedMessages: MessagesFrom<Stream> = [];
    protected aggregateRootVersionNumber = 0;
    private readonly eventHandlerMethodMap: EventHandlerMap;

    constructor(aggregateRootId: Stream['aggregateRootId'], options: AggregateRootOptions = {}) {
        this.aggregateRootId = aggregateRootId;
        this.eventHandlerMethodMap = createHandlerLookupTable(this);
        this.recordThat = this.recordThat.bind(this);
        this._clock = options.clock ?? GlobalClock;
    }

    protected recordThat<T extends AnyMessageTypeFromStream<Stream>>(type: T, payload: Stream['messages'][T], headers: AdditionalMessageHeaders = {}): void {
        const timeOfRecording = this._clock.date();
        const message: AnyMessageFrom<Stream> = {
            payload, type, headers: {
                ...headers,
                aggregate_root_id: this.aggregateRootId,
                aggregate_root_version: this.aggregateRootVersionNumber + 1,
                time_of_recording: timeOfRecording.toISOString(),
                time_of_recording_ms: timeOfRecording.getTime(),
            },
        };
        this.recordedMessages.push(message);
        this.apply(message);
    }

    protected apply(message: AnyMessageFrom<Stream>): void {
        const handlers = this.eventHandlerMethodMap.get(message.type as MessageType) ?? [];

        this.aggregateRootVersionNumber = Number(message.headers['aggregate_root_version'] || 1);

        for (const handler of handlers) {
            (this as any)[handler](message.payload, message.headers);
        }
    }

    /**
     *
     * @param messages
     * @return {this}
     */
    protected async applyAll(messages: AsyncGenerator<AnyMessageFrom<Stream>>): Promise<this> {
        for await (const m of messages) {
            this.apply(m);
        }

        return this;
    }

    aggregateRootVersion(): number {
        return this.aggregateRootVersionNumber;
    }

    releaseEvents(): MessagesFrom<Stream> {
        const events = this.recordedMessages;
        this.recordedMessages = [];
        return events;
    }

    peekEvents(): MessagesFrom<Stream> {
        return structuredClone(this.recordedMessages);
    }
}

