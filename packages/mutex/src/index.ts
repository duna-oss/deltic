import {StandardError} from '@deltic/error-standard';

export interface StaticMutex {
    tryLock(): Promise<boolean>;
    lock(timeout?: number): Promise<void>;
    unlock(): Promise<void>;
}

export type LockValue = string | number | boolean;

export interface DynamicMutex<LockID extends LockValue> {
    tryLock(id: LockID): Promise<boolean>;
    lock(id: LockID, timeout?: number): Promise<void>;
    unlock(id: LockID): Promise<void>;
}

function hasErrorMessage(error: unknown): error is {message: string} {
    return typeof (error as any).message === 'string';
}

export class UnableToAcquireLock extends StandardError {
    static becauseOfError = (id: LockValue, error: unknown) => new UnableToAcquireLock(
        `Unable to acquire lock "${id}" because or error: ${hasErrorMessage(error) ? error.message : String(error)}`,
        'mutex.unable_to_acquire_lock',
        {id},
        error,
    );
}
export class UnableToReleaseLock extends StandardError {
    static becauseOfError = (id: LockValue, error: unknown) => new UnableToReleaseLock(
        `Unable to release lock "${id}" because or error: ${hasErrorMessage(error) ? error.message : String(error)}`,
        'mutex.unable_to_release_lock',
        {id},
        error,
    );
}