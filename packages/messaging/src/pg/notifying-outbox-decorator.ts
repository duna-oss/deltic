import type {AnyMessageFrom, MessagesFrom, StreamDefinition} from '@deltic/messaging';
import type {AsyncPgPool} from '@deltic/async-pg-pool';
import type {OutboxRepository} from '@deltic/messaging/outbox';

export type NotificationConfiguration = {
    channelName?: string,
    style: 'both' | 'channel' | 'central',
}

export class NotifyingOutboxDecoratorUsingPg<Stream extends StreamDefinition> implements OutboxRepository<Stream> {
    constructor(
        private readonly pool: AsyncPgPool,
        private readonly repository: OutboxRepository<Stream>,
        private readonly tableName: string,
        private readonly config: NotificationConfiguration,
    ) {
    }

    async persist(messages: MessagesFrom<Stream>): Promise<void> {
        if (messages.length === 0) {
            return;
        }

        const inTransaction = this.pool.inTransaction();
        const transaction = inTransaction ?
            this.pool.withTransaction()
            : await this.pool.begin();

        try {
            await this.repository.persist(messages);

            const {style, channelName = 'outbox_publish'} = this.config;

            if (style !== 'central') {
                await transaction.query(`NOTIFY ${channelName}__${this.tableName}`);
            }

            if (style !== 'channel') {
                await transaction.query(`NOTIFY ${channelName}, '${this.tableName}'`);
            }

            if (!inTransaction) {
                await this.pool.commit(transaction);
            }
        } catch (e) {
            if (!inTransaction) {
                await this.pool.rollback(transaction);
            }

            throw e;
        }
    }

    retrieveBatch(size: number): AsyncGenerator<AnyMessageFrom<Stream>> {
        return this.repository.retrieveBatch(size);
    }

    async markConsumed(messages: MessagesFrom<Stream>): Promise<void> {
        return this.repository.markConsumed(messages);
    }

    async cleanupConsumedMessages(limit: number): Promise<number> {
        return this.repository.cleanupConsumedMessages(limit);
    }

    async truncate(): Promise<void> {
        return this.repository.truncate();
    }

    async numberOfPendingMessages(): Promise<number> {
        return this.repository.numberOfPendingMessages();
    }

    async numberOfConsumedMessages(): Promise<number> {
        return this.repository.numberOfConsumedMessages();
    }
}
