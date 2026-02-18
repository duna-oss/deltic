import type {DynamicMutex, LockValue} from '@deltic/mutex';
import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from './index.js';

export type LockIdResolver<Stream extends StreamDefinition, LockId extends LockValue> = (
    message: AnyMessageFrom<Stream>,
) => LockId;

export interface LockingMessageConsumerOptions<Stream extends StreamDefinition, LockId extends LockValue> {
    resolveLockId: LockIdResolver<Stream, LockId>;
    timeout?: number;
}

export class LockingMessageConsumer<
    Stream extends StreamDefinition,
    LockId extends LockValue = LockValue,
> implements MessageConsumer<Stream> {
    private readonly resolveLockId: LockIdResolver<Stream, LockId>;
    private readonly timeout: number | undefined;

    constructor(
        private readonly consumer: MessageConsumer<Stream>,
        private readonly mutex: DynamicMutex<LockId>,
        options: LockingMessageConsumerOptions<Stream, LockId>,
    ) {
        this.resolveLockId = options.resolveLockId;
        this.timeout = options.timeout;
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        const lockId = this.resolveLockId(message);

        await this.mutex.lock(lockId, this.timeout);

        try {
            await this.consumer.consume(message);
        } finally {
            await this.mutex.unlock(lockId);
        }
    }
}
