import {WaitGroup} from '@deltic/wait-group';
import {createMessageConsumer} from '../helpers.js';
import {type Message} from '../index.js';
import {AMQPChannelPool} from './channel-pool.js';
import {AMQPConnectionProvider} from './connection-provider.js';
import {AMQPMessageDispatcher} from './message-dispatcher.js';
import {AMQPMessageRelay} from './message-relay.js';

const amqpUrl = 'amqp://admin:admin@localhost:35671';
const managementUrl = 'http://localhost:35672/api';
const managementAuth = 'Basic ' + Buffer.from('admin:admin').toString('base64');

async function closeAllRabbitMQConnections(): Promise<void> {
    const response = await fetch(`${managementUrl}/connections`, {
        headers: {Authorization: managementAuth},
    });
    const connections: {name: string}[] = await response.json() as any;

    for (const connection of connections) {
        await fetch(`${managementUrl}/connections/${encodeURIComponent(connection.name)}`, {
            method: 'DELETE',
            headers: {Authorization: managementAuth},
        });
    }
}

interface EndToEndStream {
    aggregateRootId: string;
    messages: {
        something: {
            name: string;
        };
    };
}

describe('E2E tests for AMQP dispatcher and relay', () => {
    const exchangeName = 'deltic_e2e_test';
    const queueName = 'deltic_e2e_test_queue';
    const deadLetterExchange = 'deltic_e2e_test_dlx';
    const deadLetterQueue = 'deltic_e2e_test_dlq';

    test('can timeout while waiting for a channel', async () => {
        const connectionProvider = new AMQPConnectionProvider(amqpUrl);
        const channelPool = new AMQPChannelPool(connectionProvider, {
            min: 0,
            max: 0,
        });

        await expect(channelPool.channel(10)).rejects.toThrow();
    });

    test('dispatching and consuming a message', async () => {
        const connectionProvider = new AMQPConnectionProvider(amqpUrl);
        const channelPool = new AMQPChannelPool(connectionProvider);

        // Set up exchange, queue, and dead letter infrastructure via a raw channel
        const setupChannel = await channelPool.channel();
        await setupChannel.assertExchange(deadLetterExchange, 'fanout', {durable: true});
        await setupChannel.assertQueue(deadLetterQueue, {durable: true});
        await setupChannel.bindQueue(deadLetterQueue, deadLetterExchange, '');
        await setupChannel.assertExchange(exchangeName, 'fanout', {durable: true});
        await setupChannel.assertQueue(queueName, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': deadLetterExchange,
            },
        });
        await setupChannel.bindQueue(queueName, exchangeName, '');
        await setupChannel.purgeQueue(queueName);
        await setupChannel.purgeQueue(deadLetterQueue);
        await channelPool.release(setupChannel);

        const waitGroup = new WaitGroup();

        // Dispatch two messages
        const dispatcher = new AMQPMessageDispatcher<EndToEndStream>(channelPool, {exchange: exchangeName});
        const message1 = {
            type: 'something' as const,
            payload: {name: 'Frank'},
            headers: {event_id: '1234'},
        };
        const message2 = {
            type: 'something' as const,
            payload: {name: 'SharkTank'},
            headers: {event_id: '2345'},
        };
        await dispatcher.send(message1, message2);

        // First relay: fails all messages, causing dead-lettering after 3 attempts
        let failureCounter = 0;
        waitGroup.add(6);
        const failingRelay = new AMQPMessageRelay<EndToEndStream>(
            channelPool,
            createMessageConsumer<EndToEndStream>(async () => {
                failureCounter++;
                waitGroup.done();
                throw new Error('Did not go so well');
            }),
            {queueNames: [queueName], maxDeliveryAttempts: 3},
        );
        void failingRelay.start();

        try {
            await waitGroup.wait(2000);
        } finally {
            await failingRelay.stop();
        }

        // Second relay: consumes dead-lettered messages successfully
        waitGroup.add(2);
        const consumedMessages: Message<'something', {name: string}>[] = [];
        const deadLetterRelay = new AMQPMessageRelay<EndToEndStream>(
            channelPool,
            createMessageConsumer<EndToEndStream>(async (message) => {
                consumedMessages.push(message);
                waitGroup.done();
            }),
            {queueNames: [deadLetterQueue]},
        );
        void deadLetterRelay.start();

        try {
            await waitGroup.wait(2000);
        } finally {
            await deadLetterRelay.stop();
            await channelPool.close();
            await connectionProvider.close();
        }

        expect(
            consumedMessages.map(m => m.payload),
        ).toEqual([message1.payload, message2.payload]);

        expect(failureCounter).toEqual(6);
    });

    test('relay recovers after server-side connection close', async () => {
        const reconnectExchange = 'deltic_e2e_reconnect_test';
        const reconnectQueue = 'deltic_e2e_reconnect_test_queue';

        const connectionProvider = new AMQPConnectionProvider(amqpUrl);
        const channelPool = new AMQPChannelPool(connectionProvider);

        // Set up a dedicated exchange and queue for this test
        const setupChannel = await channelPool.channel();
        await setupChannel.assertExchange(reconnectExchange, 'fanout', {durable: true});
        await setupChannel.assertQueue(reconnectQueue, {durable: true});
        await setupChannel.bindQueue(reconnectQueue, reconnectExchange, '');
        await setupChannel.purgeQueue(reconnectQueue);
        await channelPool.release(setupChannel);

        const waitGroup = new WaitGroup();
        const consumedMessages: Message<'something', {name: string}>[] = [];

        // Start a relay that consumes messages
        const relay = new AMQPMessageRelay<EndToEndStream>(
            channelPool,
            createMessageConsumer<EndToEndStream>(async (message) => {
                consumedMessages.push(message);
                waitGroup.done();
            }),
            {queueNames: [reconnectQueue]},
        );
        void relay.start();

        // Dispatch a message before the connection is killed
        const dispatcher = new AMQPMessageDispatcher<EndToEndStream>(channelPool, {exchange: reconnectExchange});
        waitGroup.add(1);
        await dispatcher.send({
            type: 'something' as const,
            payload: {name: 'BeforeDisconnect'},
            headers: {event_id: 'before-1'},
        });

        // Wait for the first message to be consumed
        await waitGroup.wait(2000);
        expect(consumedMessages).toHaveLength(1);
        expect(consumedMessages[0].payload.name).toEqual('BeforeDisconnect');

        // Force-close all connections on the server side via the management API
        await closeAllRabbitMQConnections();

        // Give the relay time to detect the disconnect and reconnect
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Dispatch another message after the connection was killed and recovered
        waitGroup.add(1);
        await dispatcher.send({
            type: 'something' as const,
            payload: {name: 'AfterReconnect'},
            headers: {event_id: 'after-1'},
        });

        try {
            await waitGroup.wait(5000);
        } finally {
            await relay.stop();
            await channelPool.close();
            await connectionProvider.close();
        }

        expect(consumedMessages).toHaveLength(2);
        expect(consumedMessages[1].payload.name).toEqual('AfterReconnect');
    });
});
