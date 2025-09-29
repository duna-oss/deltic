export type LockOptions = {
    timeout?: number;
    abortSignal?: AbortSignal,
}

export interface StaticMutex {
    tryLock(options?: LockOptions): Promise<boolean>;
    lock(options?: LockOptions): Promise<void>;
    unlock(): Promise<void>;
}

export interface DynamicMutex<LockID> {
    tryLock(id: LockID, options?: LockOptions): Promise<boolean>;
    lock(id: LockID, options?: LockOptions): Promise<void>;
    unlock(id: LockID): Promise<void>;
}

function hasErrorMessage(error: unknown): error is {message: string} {
    return typeof (error as any).message === 'string';
}

export class UnableToAcquireLock extends Error {
    static becauseOfError = (error: unknown) => new UnableToAcquireLock(
        hasErrorMessage(error)
            ? `Unable to acquire lock because or error: ${error.message}`
            : 'Unable to acquire lock',
        {
            cause: error,
        },
    );
}
export class UnableToReleaseLock extends Error {
    static becauseOfError = (error: unknown) => new UnableToReleaseLock(
        hasErrorMessage(error)
            ? `Unable to release lock because or error: ${error.message}`
            : 'Unable to release lock',
        {
            cause: error,
        },
    );
}