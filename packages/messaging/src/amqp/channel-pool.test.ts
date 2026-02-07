import {AMQPChannelPool, ChannelNotLeased} from './channel-pool.js';
import {type AMQPConnectionProvider} from './connection-provider.js';
import {EventEmitter} from 'node:events';

function createFakeChannel(): any {
    return Object.assign(new EventEmitter(), {
        prefetch: async () => {},
        close: async () => {},
        waitForConfirms: async () => {},
    });
}

function createFakeConnectionProvider(): AMQPConnectionProvider {
    const fakeConnection = {
        createConfirmChannel: async () => createFakeChannel(),
    };

    return {
        connection: async () => fakeConnection,
        close: async () => {},
    } as unknown as AMQPConnectionProvider;
}

describe('AMQPChannelPool', () => {
    test('constructor rejects invalid min/max configuration', () => {
        const provider = createFakeConnectionProvider();

        expect(() => new AMQPChannelPool(provider, {min: -1})).toThrow();
        expect(() => new AMQPChannelPool(provider, {min: 10, max: 5})).toThrow();
    });

    test('releasing a channel that was not leased throws ChannelNotLeased', async () => {
        const provider = createFakeConnectionProvider();
        const pool = new AMQPChannelPool(provider);
        const fakeChannel = createFakeChannel();

        await expect(pool.release(fakeChannel)).rejects.toThrow(ChannelNotLeased);
    });

    test('a leased channel can be released back to the pool', async () => {
        const provider = createFakeConnectionProvider();
        const pool = new AMQPChannelPool(provider);

        const channel = await pool.channel();
        await pool.release(channel);

        // Should not throw - the channel was properly returned
        await pool.close();
    });

    test('requesting a channel after close throws', async () => {
        const provider = createFakeConnectionProvider();
        const pool = new AMQPChannelPool(provider);

        await pool.close();

        await expect(pool.channel()).rejects.toThrow();
    });
});
