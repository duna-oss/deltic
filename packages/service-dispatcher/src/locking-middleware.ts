import type {NextFunction, ServiceStructure} from '@deltic/service-dispatcher';
import type {DynamicMutex, LockValue} from '@deltic/mutex';
import type {LockIDResolver, LockSkipDetector} from './shared-for-locking.js';

export * from './shared-for-locking.js';

export function createServiceLockingMiddleware<S extends ServiceStructure<S>, LockId extends LockValue>({
    mutex,
    lockResolver,
    shouldSkip = () => false,
    timeoutMs,
}: {
    mutex: DynamicMutex<LockId>;
    shouldSkip?: LockSkipDetector<S>;
    lockResolver: LockIDResolver<S, LockId>;
    timeoutMs?: number;
}) {
    return async <T extends keyof S>(
        type: T,
        payload: S[T]['payload'],
        next: NextFunction<S>,
    ): Promise<S[T]['response']> => {
        const input = {type, payload};

        if (shouldSkip(input)) {
            return next(type, payload);
        }

        const lockID = lockResolver(input);
        await mutex.lock(lockID, timeoutMs);

        try {
            return await next(type, payload);
        } finally {
            await mutex.unlock(lockID);
        }
    };
}
