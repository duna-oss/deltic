import {type ConfirmChannel, type Message as AMQPMessage} from 'amqplib';
import crc32 from 'crc/crc32';
import {EventEmitter} from 'node:events';
import {StaticMutexUsingMemory} from '@deltic/mutex/static-memory';
import {type ProcessQueue, SequentialProcessQueue, PartitionedProcessQueue} from '@deltic/process-queue';
import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from '../index.js';
import {messageWithHeaders} from '../helpers.js';
import {type AMQPChannelPool} from './channel-pool.js';
import {
    type MessageDeliveryCounter,
    MessageDeliveryCounterUsingMemory,
} from '../message-delivery-counter.js';

export type AMQPMessageRelayOptions = {
    queueNames: string[];
    maxDeliveryAttempts?: number;
    maxConcurrency?: number;
};

type MessageToProcess<Stream extends StreamDefinition> = {
    amqp: AMQPMessage;
    message: AnyMessageFrom<Stream>;
};

export class AMQPMessageRelay<Stream extends StreamDefinition> {
    private shuttingDown: boolean = false;
    private readonly startupIsolation = new StaticMutexUsingMemory();
    private channel: undefined | ConfirmChannel = undefined;
    private processQueue: ProcessQueue<MessageToProcess<Stream>>;
    private consumerTags: string[] = [];
    private waiter: PromiseWithResolvers<void> | undefined = undefined;
    private startupTriggers = new EventEmitter<{start: []}>();

    constructor(
        private readonly channelPool: AMQPChannelPool,
        private readonly consumer: MessageConsumer<Stream>,
        private readonly options: AMQPMessageRelayOptions,
        private readonly deliveryAttempts: MessageDeliveryCounter<string> = new MessageDeliveryCounterUsingMemory(),
    ) {
        this.startupTriggers.on('start', () => {
            void this.startup().catch(() => {});
        });
        const maxDeliveryAttempts = this.options.maxDeliveryAttempts ?? 10;

        this.processQueue = new PartitionedProcessQueue(
            () => new SequentialProcessQueue<MessageToProcess<Stream>>({
                autoStart: true,
                processor: async (task) => {
                    await this.consumer.consume(task.message);
                    this.channel?.ack(task.amqp, false);
                    await this.channel?.waitForConfirms();
                },
                onError: async (context) => {
                    const numberOfAttempts = await this.deliveryAttempts.increment(
                        String(context.task.message.headers['event_id']),
                    );
                    const shouldRedeliver = maxDeliveryAttempts > numberOfAttempts;

                    context.skipCurrentTask();
                    this.channel?.nack(context.task.amqp, false, shouldRedeliver);
                },
            }),
            (message) => crc32(String(message.message.headers['aggregate_root_id'] ?? '-')),
            options.maxConcurrency ?? 20,
        );
    }

    async start(): Promise<void> {
        this.shuttingDown = false;

        if (this.waiter) {
            throw new Error('Already started');
        }

        this.waiter = Promise.withResolvers<void>();
        this.startupTriggers.emit('start');

        return this.waiter.promise;
    }

    private async startup(): Promise<void> {
        await this.startupIsolation.lock(5000);

        try {
            this.consumerTags = [];
            await this.processQueue.purge();
            this.processQueue.start();
            this.channel = await this.channelPool.channel();

            this.channel.on('close', () => {
                if (!this.shuttingDown) {
                    this.startupTriggers.emit('start');
                }
            });

            const starters: Promise<any>[] = [];

            for (const queueName of this.options.queueNames) {
                starters.push((async (queueName: string) => {
                    if (!this.channel) {
                        return;
                    }

                    const {consumerTag} = await this.channel.consume(queueName, (amqp: AMQPMessage | null) => {
                        if (!amqp) {
                            return;
                        }

                        const message: AnyMessageFrom<Stream> = JSON.parse(amqp.content.toString() || '');
                        void this.processQueue.push({
                            amqp,
                            message: messageWithHeaders(message, {
                                amqp_queue_name: queueName,
                            }),
                        });
                    }, {noAck: false});
                    this.consumerTags.push(consumerTag);
                })(queueName));
            }

            await Promise.all(starters);
        } finally {
            await this.startupIsolation.unlock();
        }
    }

    async stop(): Promise<void> {
        await this.startupIsolation.lock(5000);
        this.shuttingDown = true;
        await this.startupIsolation.unlock();

        if (!this.waiter) {
            return;
        }

        await Promise.all(this.consumerTags.map(tag => this.channel?.cancel(tag)));
        await this.processQueue.stop();

        if (this.channel) {
            await this.channelPool.release(this.channel);
        }

        this.waiter.resolve();
    }
}
