import 'reflect-metadata';
import type {AnyMessageFrom, StreamDefinition} from '@deltic/messaging';
import {AggregateRootBehavior, type AggregateRootOptions, type AggregateStream} from '@deltic/event-sourcing';

const metaKey = Symbol.for('deltic:event-sourcing:apply-func');

type MessageType = string;
type KeyType = string | symbol;
export type EventHandlerMap<Stream extends StreamDefinition> = Map<keyof Stream['messages'], KeyType[]>;

export const makeEventHandler =
    <Stream extends AggregateStream<Stream>>(): DecoratedHandler<Stream> =>
    <T extends keyof Stream['messages']>(messageType: T): MethodDecorator => {
        return (aggregateRoot: object, key: KeyType) => {
            const metadata: EventHandlerMap<Stream> = Reflect.getMetadata(metaKey, aggregateRoot) || new Map();
            const handlers = metadata.get(messageType) ?? [];
            handlers.push(key);
            metadata.set(messageType, handlers);
            Reflect.defineMetadata(metaKey, metadata, aggregateRoot);
        };
    };

export interface DecoratedHandler<Stream extends AggregateStream<Stream>> {
    <T extends keyof Stream['messages']>(messageType: T): MethodDecorator;
}

export function createHandlerLookupTable(target: object) {
    return Reflect.getMetadata(metaKey, target) || new Map();
}

export abstract class AggregateRootUsingReflectMetadata<
    Stream extends AggregateStream<Stream>,
> extends AggregateRootBehavior<Stream> {
    private readonly eventHandlerMethodMap: EventHandlerMap<Stream>;

    constructor(aggregateRootId: Stream['aggregateRootId'], options: AggregateRootOptions = {}) {
        super(aggregateRootId, options);
        this.eventHandlerMethodMap = createHandlerLookupTable(this);
    }

    protected apply(message: AnyMessageFrom<Stream>): void {
        const handlers = this.eventHandlerMethodMap.get(message.type as MessageType) ?? [];

        this.aggregateRootVersionNumber = Number(message.headers['aggregate_root_version'] || 1);

        for (const handler of handlers) {
            (this as any)[handler](message.payload, message.headers);
        }
    }
}
