import type {AnyMessageFrom, MessageConsumer, MessageRepository, StreamDefinition} from './index.js';
import type {OffsetRepository} from '@deltic/offset-tracking';
import {NoopTransactionManager, type TransactionManager} from '@deltic/transaction-manager';

export interface IdentifierResolver<Stream extends StreamDefinition> {
    (message: AnyMessageFrom<Stream>): string;
}

export type OffsetResolver = <Stream extends StreamDefinition>(message: AnyMessageFrom<Stream>) => number;

export class ExactlyOnceConsumerDecorator<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    constructor(
        private readonly offsets: OffsetRepository,
        private readonly consumer: MessageConsumer<Stream>,
        private readonly messages: MessageRepository<Stream>,
        private readonly transactions: TransactionManager = new NoopTransactionManager(),
        private readonly resolveIdentifier: IdentifierResolver<Stream> = message => message.headers['aggregate_root_id']?.toString() ?? 'unknown',
        private readonly resolveOffset: OffsetResolver = message => Number(message.headers['aggregate_root_version'] ?? 0),
    ) {
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        const messageId = message.headers.aggregate_root_id;

        if (messageId === undefined) {
            throw new Error('Encountered message without aggregate_root_id header');
        }

        const identifier = this.resolveIdentifier(message);
        const storedOffset = await this.offsets.retrieve(identifier) ?? 0;
        const currentOffset = this.resolveOffset(message);

        /**
         * Prevent double delivery
         */
        if (storedOffset >= currentOffset) {
            return;
        }

        if (storedOffset < (currentOffset - 1)) {
            await this.replayBetween(messageId, storedOffset, currentOffset);
        }

        await this.forwardMessage(message);
    }

    private async forwardMessage(message: AnyMessageFrom<Stream>): Promise<void> {
        const offset = this.resolveOffset(message);
        const identifier = this.resolveIdentifier(message);

        await this.transactions.begin();

        try {
            await this.offsets.store(identifier, offset);
            await this.consumer.consume(message);
        } catch (error) {
            await this.transactions.abort();
            throw error;
        }

        await this.transactions.commit();
    }

    private async replayBetween(id: Stream['aggregateRootId'], after: number, before: number): Promise<void> {
        const messages = this.messages.retrieveBetweenVersions(id, after, before);

        for await (const message of messages) {
            await this.forwardMessage(message);
        }
    }
}