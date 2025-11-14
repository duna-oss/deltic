import {AnyInputForService, ServiceStructure} from '@deltic/service-dispatcher';
import {DynamicMutex, LockValue} from '@deltic/mutex';

export interface LockIDResolver<
    Service extends ServiceStructure<Service>,
    LockID,
> {
    (input: AnyInputForService<Service>): LockID;
}

export interface LockSkipDetector<Service extends ServiceStructure<Service>> {
    (input: AnyInputForService<Service>): boolean;
}

export const defaultLockTimeoutMs: number = Number(process.env.DELTIC_LOCK_TIMEOUT_MS ?? 5000);

export interface ServiceLockingOptions<
    S extends ServiceStructure<S>,
    LockId extends LockValue,
> {
    mutex: DynamicMutex<LockId>,
    shouldSkip?: LockSkipDetector<S>,
    lockResolver: LockIDResolver<S, LockId>,
    timeoutMs?: number,
}