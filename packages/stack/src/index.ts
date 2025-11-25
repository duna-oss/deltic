import type {MessageRepository, StreamDefinition} from '@deltic/messaging';
import type {OutboxRepository} from '@deltic/messaging/outbox';
import type {OffsetIdType, OffsetRepository, OffsetType} from '@deltic/offset-tracking';

export interface PersistenceProvider {
    messageRepository<Stream extends StreamDefinition>(): MessageRepository<Stream>;
    outboxRepository<Stream extends StreamDefinition>(): OutboxRepository<Stream>;
    offsetRepository<Offset extends OffsetType, Id extends OffsetIdType>(): OffsetRepository<Offset, Id>;
}

export class StackProvider {
    constructor(
        persistence: PersistenceProvider,
    ) {
    }
}