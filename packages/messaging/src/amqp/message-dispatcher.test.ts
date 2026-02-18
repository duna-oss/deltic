import {AMQPMessageDispatcher, UnableToDispatchMessages} from './message-dispatcher.js';
import {type AMQPChannelPool} from './channel-pool.js';
import type {StreamDefinition} from '../index.js';

interface TestStream extends StreamDefinition {
    aggregateRootId: string;
    messages: {
        test_event: {name: string};
    };
}

function createFakeChannel(options: {shouldFail?: boolean} = {}): any {
    return {
        publish: () => true,
        waitForConfirms: async () => {
            if (options.shouldFail) {
                throw new Error('Confirm failed');
            }
        },
    };
}

function createFakeChannelPool(options: {
    shouldFail?: boolean;
    failCount?: number;
} = {}): AMQPChannelPool {
    let failures = 0;

    return {
        channel: async () => {
            if (options.shouldFail && failures < (options.failCount ?? Infinity)) {
                failures++;
                throw new Error('Channel unavailable');
            }
            return createFakeChannel();
        },
        release: async () => {},
    } as unknown as AMQPChannelPool;
}

describe('AMQPMessageDispatcher', () => {
    test('sending an empty message array is a no-op', async () => {
        let channelRequested = false;
        const pool = {
            channel: async () => {
                channelRequested = true;
                return createFakeChannel();
            },
            release: async () => {},
        } as unknown as AMQPChannelPool;

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {exchange: 'test-exchange'});

        await dispatcher.send();

        expect(channelRequested).toBe(false);
    });

    test('messages are published with the correct exchange and routing key', async () => {
        const published: {exchange: string; routingKey: string; content: string}[] = [];
        const channel = {
            publish: (exchange: string, routingKey: string, content: Buffer) => {
                published.push({exchange, routingKey, content: content.toString()});
                return true;
            },
            waitForConfirms: async () => {},
        };
        const pool = {
            channel: async () => channel,
            release: async () => {},
        } as unknown as AMQPChannelPool;

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {exchange: 'my-exchange'});

        await dispatcher.send({
            type: 'test_event',
            payload: {name: 'Alice'},
            headers: {},
        });

        expect(published).toHaveLength(1);
        expect(published[0].exchange).toEqual('my-exchange');
        expect(published[0].routingKey).toEqual('test_event');
        expect(JSON.parse(published[0].content).payload.name).toEqual('Alice');
    });

    test('throws UnableToDispatchMessages after exhausting retries', async () => {
        const pool = createFakeChannelPool({shouldFail: true});

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {
            exchange: 'test-exchange',
            maxTries: 3,
        });

        await expect(dispatcher.send({
            type: 'test_event',
            payload: {name: 'Bob'},
            headers: {},
        })).rejects.toThrow(UnableToDispatchMessages);
    });

    test('retries and succeeds after transient failure', async () => {
        let attempts = 0;
        const channel = {
            publish: () => true,
            waitForConfirms: async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Transient failure');
                }
            },
        };
        const pool = {
            channel: async () => channel,
            release: async () => {},
        } as unknown as AMQPChannelPool;

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {
            exchange: 'test-exchange',
            maxTries: 3,
        });

        await dispatcher.send({
            type: 'test_event',
            payload: {name: 'Charlie'},
            headers: {},
        });

        expect(attempts).toEqual(3);
    });

    test('uses a custom exchange resolver function', async () => {
        const published: {exchange: string}[] = [];
        const channel = {
            publish: (exchange: string) => {
                published.push({exchange});
                return true;
            },
            waitForConfirms: async () => {},
        };
        const pool = {
            channel: async () => channel,
            release: async () => {},
        } as unknown as AMQPChannelPool;

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {
            exchange: (message) => `exchange-for-${String(message.type)}`,
        });

        await dispatcher.send({
            type: 'test_event',
            payload: {name: 'Diana'},
            headers: {},
        });

        expect(published[0].exchange).toEqual('exchange-for-test_event');
    });

    test('uses a custom routing key resolver', async () => {
        const published: {routingKey: string}[] = [];
        const channel = {
            publish: (_exchange: string, routingKey: string) => {
                published.push({routingKey});
                return true;
            },
            waitForConfirms: async () => {},
        };
        const pool = {
            channel: async () => channel,
            release: async () => {},
        } as unknown as AMQPChannelPool;

        const dispatcher = new AMQPMessageDispatcher<TestStream>(pool, {
            exchange: 'test-exchange',
            routingKey: (message) => `custom.${String(message.type)}`,
        });

        await dispatcher.send({
            type: 'test_event',
            payload: {name: 'Eve'},
            headers: {},
        });

        expect(published[0].routingKey).toEqual('custom.test_event');
    });
});
