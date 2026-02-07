import {connect, type ChannelModel} from 'amqplib';
import {setTimeout as wait} from 'timers/promises';
import {type BackOffStrategy} from '@deltic/backoff';
import {LinearBackoffStrategy} from '@deltic/backoff/linear';
import {StandardError, errorToMessage} from '@deltic/error-standard';

export class UnableToEstablishConnection extends StandardError {
    static becauseOfTimeout = (identifier: string) =>
        new UnableToEstablishConnection(
            `Unable to establish AMQP connection "${identifier}" within the given timeout`,
            'amqp.unable_to_establish_connection',
            {identifier},
        );

    static becauseOfError = (identifier: string, reason: unknown) =>
        new UnableToEstablishConnection(
            `Unable to establish AMQP connection "${identifier}": ${errorToMessage(reason)}`,
            'amqp.unable_to_establish_connection',
            {identifier},
            reason,
        );
}

export class ConnectionShuttingDown extends StandardError {
    static forIdentifier = (identifier: string) =>
        new ConnectionShuttingDown(
            `AMQP connection "${identifier}" is shutting down`,
            'amqp.connection_shutting_down',
            {identifier},
        );
}

export type ConnectionUrl = string | string[] | (() => string | string[]);
export type ResolvedConnectionUrls = string[];

export type AMQPConnectionProviderOptions = {
    heartbeat?: number;
    backoff?: BackOffStrategy;
};

const defaultHeartbeat = 15;

export class AMQPConnectionProvider {
    private shuttingDown: boolean = false;
    private index: number = -1;
    private readonly connections: Map<string, ChannelModel> = new Map();
    private readonly waiters: Map<string, Promise<ChannelModel>> = new Map();
    private readonly heartbeat: number;
    private readonly backoff: BackOffStrategy;

    constructor(
        private readonly connectionUrl: ConnectionUrl,
        options: AMQPConnectionProviderOptions = {},
    ) {
        this.heartbeat = options.heartbeat ?? defaultHeartbeat;
        this.backoff = options.backoff ?? new LinearBackoffStrategy(100);
    }

    async connection(identifier: string = 'shared', timeout: undefined | number = undefined): Promise<ChannelModel> {
        if (this.shuttingDown) {
            throw ConnectionShuttingDown.forIdentifier(identifier);
        }

        const currentConnection = this.connections.get(identifier);

        if (currentConnection) {
            return currentConnection;
        }

        /**
         * When multiple processes are asking for the same connection, use
         * the same promise to bundle the requests. In this scenario, the first
         * call registers the promise. Subsequent calls resolve the promise,
         * which, when resolved, provides them with the connection.
         */
        const currentPromise = this.waiters.get(identifier);

        if (currentPromise !== undefined) {
            return currentPromise;
        }

        const {promise, reject, resolve} = Promise.withResolvers<ChannelModel>();
        this.waiters.set(identifier, promise);

        void this.resolveConnection(identifier, timeout, resolve, reject);

        return promise;
    }

    private async resolveConnection(
        identifier: string,
        timeout: number | undefined,
        resolve: (connection: ChannelModel) => void,
        reject: (error: unknown) => void,
    ): Promise<void> {
        let keepGoing = true;
        let attempt = 0;
        let lastError: unknown = undefined;
        let timer: NodeJS.Timeout | undefined = undefined;

        if (timeout !== undefined) {
            timer = setTimeout(() => keepGoing = false, timeout);
        }

        while (keepGoing && !this.shuttingDown) {
            const urls = this.resolveNextCredentials(this.connectionUrl);
            this.index++;

            if (this.index >= urls.length) {
                this.index = 0;
            }

            try {
                const connectionUrl = this.applyConnectionOptions(urls[this.index]);
                const connection = await connect(connectionUrl);

                connection.on('close', () => {
                    this.connections.delete(identifier);
                    this.waiters.delete(identifier);
                });

                this.connections.set(identifier, connection);
                clearTimeout(timer);
                resolve(connection);

                return;
            } catch (error) {
                lastError = error;
            }

            attempt++;
            const delay = this.backoff.backOff(attempt);
            await wait(delay);
        }

        this.waiters.delete(identifier);

        const error = lastError !== undefined
            ? UnableToEstablishConnection.becauseOfError(identifier, lastError)
            : UnableToEstablishConnection.becauseOfTimeout(identifier);

        reject(error);
    }

    private applyConnectionOptions(url: string): string {
        const parsed = new URL(url);
        parsed.searchParams.set('heartbeat', String(this.heartbeat));

        return parsed.toString();
    }

    /**
     * Credentials are expected to be resolved in the same order each time. This is important
     * because the resolution mechanism will try to loop through them and try each variant. But,
     * during the connection phase, the credentials can change, for which they need to be re-fetched
     * on every try.
     */
    private resolveNextCredentials(urls: ConnectionUrl): ResolvedConnectionUrls {
        if (typeof urls === 'function') {
            urls = urls();
        }

        if (Array.isArray(urls)) {
            return urls;
        }

        return [urls];
    }

    async close(): Promise<void> {
        this.shuttingDown = true;

        /**
         * Wait for all in progress connections to settle (rejected or resolved). This ensures
         * that we can now know there won't be any more connections incoming and we can go and
         * close all active connections.
         */
        await Promise.allSettled(Array.from(this.waiters.values()));

        await Promise.all(Array.from(
            this.connections.values(),
            connection => connection.close(),
        ));
    }
}
