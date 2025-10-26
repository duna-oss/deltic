import {Service, ServiceStructure} from '@deltic/service-dispatcher';
import {DynamicMutex, LockValue} from '@deltic/mutex';
import {defaultLockTimeoutMs, LockIDResolver, LockSkipDetector, ServiceLockingOptions} from './shared.js';

export class ServiceLocking<
    S extends ServiceStructure<S>,
    LockId extends LockValue,
> implements Service<S> {
    private readonly mutex: DynamicMutex<LockId>;
    private lockResolver: LockIDResolver<S, LockId>;
    private timeoutMs: number;
    private shouldSkip: LockSkipDetector<S>;
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

    async handle<
        T extends keyof S,
    >(type: T, payload: S[T]['payload']): Promise<S[T]['response']> {
        const input = {type, payload};

        if (this.shouldSkip(input)) {
            return this.service.handle(type, payload);
        }

        const lockID = this.lockResolver(input);
        await this.mutex.lock(lockID, this.timeoutMs);

        try {
            return await this.service.handle(type, payload);
        } finally {
            await this.mutex.unlock(lockID);
        }
    }
}
