import type {InputForServiceOfType, Service, ServiceStructure} from '@deltic/service-dispatcher';
import type {DynamicMutex, LockValue} from '@deltic/mutex';
import {
    defaultLockTimeoutMs,
    type LockIDResolver,
    type LockSkipDetector,
    type ServiceLockingOptions,
} from './shared-for-locking.js';

export * from './shared-for-locking.js';

export class ServiceLocking<S extends ServiceStructure<S>, LockId extends LockValue> implements Service<S> {
    private readonly mutex: DynamicMutex<LockId>;
    private readonly lockResolver: LockIDResolver<S, LockId>;
    private readonly timeoutMs: number;
    private readonly shouldSkip: LockSkipDetector<S>;
    constructor(
        private readonly service: Service<S>,
        readonly options: ServiceLockingOptions<S, LockId>,
    ) {
        const {shouldSkip = () => false, lockResolver, mutex, timeoutMs = defaultLockTimeoutMs} = options;
        this.shouldSkip = shouldSkip;
        this.lockResolver = lockResolver;
        this.mutex = mutex;
        this.timeoutMs = timeoutMs;
    }

    async handle<T extends keyof S>(input: InputForServiceOfType<S, T>): Promise<S[T]['response']> {
        if (this.shouldSkip(input)) {
            return this.service.handle(input);
        }

        const lockID = this.lockResolver(input);
        await this.mutex.lock(lockID, this.timeoutMs);

        try {
            return await this.service.handle(input);
        } finally {
            await this.mutex.unlock(lockID);
        }
    }
}
