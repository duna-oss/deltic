import type {
    AdditionalMessageHeaders,
    AnyMessageFrom,
    AnyMessageTypeFromStream,
    Header,
    Message,
    MessageConsumer,
    MessageConsumerFunc,
    MessageDecorator,
    MessageDecoratorFunc,
    MessageDispatcher,
    MessageDispatcherFunc,
    MessageHeaders,
    MessagesFrom,
    StreamDefinition,
} from './index.js';

export function createMessageDispatcher<Stream extends StreamDefinition>(send: MessageDispatcherFunc<Stream>): MessageDispatcher<Stream> {
    return {send};
}

export function createMessageConsumer<Stream extends StreamDefinition>(consume: MessageConsumerFunc<Stream>): MessageConsumer<Stream> {
    return {consume};
}

export function createMessageDecorator<Stream extends StreamDefinition>(decorator: MessageDecoratorFunc<Stream>): MessageDecorator<Stream> {
    return {
        decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
            return messages.map(decorator);
        },
    };
}

export function messageFactory<Stream extends StreamDefinition>(): <T extends keyof Stream['messages']>(type: T, payload: Stream['messages'][T], headers?: MessageHeaders) => Message<T, Stream['messages'][T], Stream['aggregateRootId']> {
    return (type, payload, headers = {}) => ({
        headers: {...headers},
        type,
        payload,
    });
}

export const withoutHeaders = <Stream extends StreamDefinition>(message: AnyMessageFrom<Stream>): AnyMessageFrom<Stream> => ({...message, headers: {}});

export function timeOfRecordingFromHeaders(headers: MessageHeaders): number {
    return Number(headers['time_of_recording_ms'] ?? new Date(String(headers['time_of_recording'])).getTime());
}

export function timeOfRecordingFromMessage<Stream extends StreamDefinition>(message: AnyMessageFrom<Stream>): number {
    return timeOfRecordingFromHeaders(message.headers);
}

export function messageWithHeader<M extends Message<any, any>>(message: M, header: Header): M {
    return {...message, headers: {...message.headers, [header.key]: header.value}};
}

export function messageWithHeaders<M extends Message<any, any>>(message: M, headers: AdditionalMessageHeaders): M {
    return {...message, headers: {...message.headers, ...headers}};
}

export const createMessage = <
    const Stream extends StreamDefinition,
    const T extends AnyMessageTypeFromStream<Stream> = AnyMessageTypeFromStream<Stream>,
>(
    type: T,
    payload: Stream['messages'][T],
    headers: MessageHeaders<Stream['aggregateRootId']> = {},
): AnyMessageFrom<Stream> => {
    return {
        headers,
        type,
        payload,
    };
};

export const collect = async <T>(i: AsyncGenerator<T>): Promise<T[]> => {
    const r: T[] = [];

    for await (const m of i) {
        r.push(m);
    }

    return r;
};