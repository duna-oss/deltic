import type {AnyMessageFrom, MessageDispatcher, MessagesFrom, StreamDefinition} from './index.js';
import {messageWithHeader, messageWithHeaders} from './helpers.js';

/**
 * Implementation of the transactional outbox pattern.
 * The goal of this pattern is to prevent inconsistent data whenever an operation needs to write both to the datastore (e.g. to store an event) and to a message broker (e.g. rabbitMQ).
 * This pattern works by:
 * - Ensuring that we write to the datastore (e.g. to store the event) and to the outbox datastore table in the same transaction.
 * - Messages are then relayed to the message broker from the outbox database table.
 *
 * This prevents inconsistent data because:
 * - Messages are only stored in the outbox repository if the original operation succeeds.
 * - Failures in the message broker don't lead to missing data because the unconsumed message is stored in the outbox repository.
 */
export const OUTBOX_ID_HEADER_KEY = '__outbox_id';
export const OUTBOX_TABLE_HEADER_KEY = '__outbox_table';
export const OUTBOX_CONSUMED_HEADER_KEY = '__outbox_consumed';

/**
 * The OutboxMessageDispatcher stores the incoming messages in the outbox repository.
 * This is what will be called by the original operation within a transaction.
 */
export class OutboxMessageDispatcher<Stream extends StreamDefinition> implements MessageDispatcher<Stream> {
    constructor(private readonly outbox: OutboxRepository<Stream>) {
    }

    async send(...messages: MessagesFrom<Stream>): Promise<void> {
        await this.outbox.persist(messages);
    }
}

export interface OutboxRepository<Stream extends StreamDefinition> {
    persist(messages: MessagesFrom<Stream>): Promise<void>,
    retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>>,
    markConsumed(messages: MessagesFrom<Stream>): Promise<void>,
    cleanupConsumedMessages(limit: number): Promise<number>,
    truncate(): Promise<void>,
    numberOfPendingMessages(): Promise<number>,
    numberOfConsumedMessages(): Promise<number>,
}

/**
 * RelayThroughMessageDispatcher is used to send (a.k.a. relay) the messages stored in the outbox to a dispatcher.
 * This will often be used to relay the messages to the message broker. However, any dispatcher implementing the same
 * interface may be used.
 */
export class OutboxRelay<Stream extends StreamDefinition> {
    constructor(
        private readonly outbox: OutboxRepository<Stream>,
        private readonly dispatcher: MessageDispatcher<Stream>,
    ) {
    }

    async relayBatch(batchSize: number, commitSize: number): Promise<number> {
        let relayedCount = 0;
        let batch: MessagesFrom<Stream> = [];

        const processBatch = async (messages: MessagesFrom<Stream>): Promise<void> => {
            if (messages.length === 0) {
                return;
            }

            await this.dispatcher.send(...messages);
            /**
             * Await after await usually is a bad practice. In this
             * instance we want to ensure the batch had been dispatched
             * before marking the messages as consumed.
             */
            await this.outbox.markConsumed(messages);
        };

        for await (const message of this.outbox.retrieveBatch(batchSize)) {
            batch.push(message);
            relayedCount++;

            if (relayedCount % commitSize === 0) {
                await processBatch(batch);
                batch = [];
            }
        }

        await processBatch(batch);

        return relayedCount;
    }
}

export class OutboxRepositoryUsingMemory<Stream extends StreamDefinition> implements OutboxRepository<Stream> {
    private incrementalId = 0;
    private messages: MessagesFrom<Stream> = [];

    async cleanupConsumedMessages(limit: number): Promise<number> {
        let removed = 0;
        while (removed < limit) {
            const m = this.messages.at(0);
            if (m === undefined || m.headers[OUTBOX_CONSUMED_HEADER_KEY] !== 'yes') {
                return removed;
            }
            removed++;
            this.messages.shift();
        }
        return removed;
    }

    async markConsumed(messages: MessagesFrom<Stream>): Promise<void> {
        const ids = messages.map(m => m.headers[OUTBOX_ID_HEADER_KEY]);

        this.messages = this.messages.map(
            m => ids.includes(m.headers[OUTBOX_ID_HEADER_KEY])
                ? messageWithHeader(m, {key: OUTBOX_CONSUMED_HEADER_KEY, value: 'yes'})
                : m,
        );
    }

    async persist(messages: MessagesFrom<Stream>): Promise<void> {
        this.messages.push(...messages.map(m => messageWithHeaders(m, {
            [OUTBOX_ID_HEADER_KEY]: ++this.incrementalId,
            [OUTBOX_CONSUMED_HEADER_KEY]: 'no',
        })));
    }

    async* retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>> {
        let count = 0;
        for (const message of this.messages) {
            if (count >= size) {
                return;
            }

            if (message.headers[OUTBOX_CONSUMED_HEADER_KEY] !== 'yes') {
                count++;
                yield message;
            }
        }
    }

    async truncate(): Promise<void> {
        this.messages = [];
    }

    async numberOfPendingMessages(): Promise<number> {
        return this.messages.filter(m => m.headers[OUTBOX_CONSUMED_HEADER_KEY] !== 'yes').length;
    }

    async numberOfConsumedMessages(): Promise<number> {
        return this.messages.filter(m => m.headers[OUTBOX_CONSUMED_HEADER_KEY] === 'yes').length;
    }

    clear(): void {
        this.messages = [];
    }
}
