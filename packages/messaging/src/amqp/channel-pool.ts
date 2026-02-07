import {type ChannelModel, type ConfirmChannel} from 'amqplib';
import {WaitGroup} from '@deltic/wait-group';
import {StandardError} from '@deltic/error-standard';
import {type AMQPConnectionProvider} from './connection-provider.js';

export class ChannelPoolExhausted extends StandardError {
    static becauseOfTimeout = () =>
        new ChannelPoolExhausted(
            'Timed out waiting for an available AMQP channel',
            'amqp.channel_pool_exhausted',
        );

    static becausePoolIsEmpty = () =>
        new ChannelPoolExhausted(
            'Unexpectedly could not resolve a channel from the pool',
            'amqp.channel_pool_exhausted',
        );
}

export class ChannelPoolClosed extends StandardError {
    static whileRetrievingConnection = () =>
        new ChannelPoolClosed(
            'Could not retrieve a connection when the pool is closing or closed',
            'amqp.channel_pool_closed',
        );
}

export class ChannelNotLeased extends StandardError {
    static onRelease = () =>
        new ChannelNotLeased(
            'Tried releasing a channel that was not leased',
            'amqp.channel_not_leased',
        );
}

export type AMQPChannelPoolOptions = {
    min?: number;
    max?: number;
    connectionName?: string;
    connectionTimeout?: number;
    prefetchCount?: number;
};

/**
 * Channels are relatively lightweight constructs that talk over connections. They require
 * asynchronous life-cycle management, which makes them a little difficult to deal with
 * when depending on a pool. Having to resolve a channel and managing its lifecycle in every
 * part that requires it is tedious. By using a channel pool, we can reduce this burden and
 * manage their lifecycle centrally.
 */
export class AMQPChannelPool {
    private closing: boolean = false;
    private blockers: PromiseWithResolvers<void>[] = [];
    private shutdownWaiter = new WaitGroup();
    private activeConnection: ChannelModel | undefined = undefined;
    private pool: ConfirmChannel[] = [];
    private leased = new Set<ConfirmChannel>();

    constructor(
        private readonly connectionProvider: AMQPConnectionProvider,
        private readonly options: AMQPChannelPoolOptions = {},
    ) {
        const min = this.options.min ?? 10;
        const max = this.options.max ?? 100;

        if (min < 0 || max < min) {
            throw new Error('Min needs to be positive and less than max.');
        }
    }

    async channel(timeout: number = 5000): Promise<ConfirmChannel> {
        if (this.pool.length > 0) {
            const channel = this.pool.shift();

            if (channel === undefined) {
                throw ChannelPoolExhausted.becausePoolIsEmpty();
            }

            this.shutdownWaiter.add();
            this.leased.add(channel);

            return channel;
        }

        const max = this.options.max ?? 100;

        if (this.leased.size >= max) {
            const blocker = Promise.withResolvers<void>();
            this.blockers.push(blocker);
            const timer = setTimeout(
                () => blocker.reject(ChannelPoolExhausted.becauseOfTimeout()),
                timeout,
            );
            await blocker.promise;
            clearTimeout(timer);

            const channel = this.pool.shift();

            if (channel === undefined) {
                throw ChannelPoolExhausted.becausePoolIsEmpty();
            }

            this.shutdownWaiter.add();
            this.leased.add(channel);

            return channel;
        }

        try {
            this.shutdownWaiter.add();
            const connection = await this.connection();
            const channel = await connection.createConfirmChannel();
            const prefetchCount = this.options.prefetchCount ?? 10;

            this.leased.add(channel);
            await channel.prefetch(prefetchCount);

            return channel;
        } catch (e) {
            this.shutdownWaiter.done();
            throw e;
        }
    }

    async release(channel: ConfirmChannel): Promise<void> {
        if (!this.leased.delete(channel)) {
            throw ChannelNotLeased.onRelease();
        }

        if (this.closing) {
            await Promise.allSettled([channel.close()]);
            this.shutdownWaiter.done();
        } else {
            const min = this.options.min ?? 10;

            if (this.pool.length > min) {
                await Promise.allSettled([channel.close()]);
                this.shutdownWaiter.done();
            } else {
                this.pool.push(channel);
                this.shutdownWaiter.done();

                const blocker = this.blockers.shift();

                if (blocker !== undefined) {
                    blocker.resolve();
                }
            }
        }
    }

    private async connection(): Promise<ChannelModel> {
        if (this.closing) {
            throw ChannelPoolClosed.whileRetrievingConnection();
        }

        const connection = await this.connectionProvider.connection(
            this.options.connectionName,
            this.options.connectionTimeout,
        );

        /**
         * When we have leased channels and there is a new connection resolved, the pool
         * is no longer useful. Any channel that was in use was connected to a closed connection.
         */
        if (this.activeConnection !== connection) {
            this.pool = [];
        }

        this.activeConnection = connection;

        return connection;
    }

    async close(timeout?: number): Promise<void> {
        this.closing = true;
        await Promise.allSettled(this.pool.map(channel => channel.close()));
        await this.shutdownWaiter.wait(timeout);
    }
}
