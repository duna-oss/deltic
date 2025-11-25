import {DynamicMutex, LockValue, UnableToAcquireLock, UnableToReleaseLock} from './index.js';

interface LockWaiter {
    done: boolean;
    promise: PromiseWithResolvers<void>;
}

export class MutexUsingMemory<LockID extends LockValue> implements DynamicMutex<LockID> {
    private readonly locks = new Map<LockID, true>();
    private waiters: LockWaiter[] = [];

    lock(id: LockID, timeout?: number): Promise<void> {
        if (this.tryLockSync(id)) {
            return Promise.resolve();
        }

        const promise = Promise.withResolvers<void>();
        const lockWaiter: LockWaiter = {
            done: false,
            promise: promise,
        };
        this.waiters.push(lockWaiter);
        let timer: ReturnType<typeof setTimeout> | undefined = undefined;

        if (timeout !== undefined) {
            timer = setTimeout(() => {
                lockWaiter.promise.reject('Time ran out.');
            }, timeout);
        }

        return promise.promise.then(
            () => {
                clearTimeout(timer);
                lockWaiter.done = true;
            },
            reason => {
                lockWaiter.done = true;
                throw UnableToAcquireLock.becauseOfError(id, reason);
            }
        );
    }

    private tryLockSync(id: LockID): boolean {
        if (this.locks.get(id)) {
            return false;
        }

        this.locks.set(id, true);

        return true;
    }

    async tryLock(id: LockID): Promise<boolean> {
        return this.tryLockSync(id);
    }

    async unlock(id: LockID): Promise<void> {
        if (!this.locks.get(id)) {
            throw UnableToReleaseLock.becauseOfError(id, 'Lock ID does not exist.');
        }

        let waiter = this.waiters.shift();

        while(waiter && waiter.done) {
            waiter = this.waiters.shift();
        }

        if (waiter) {
            waiter.promise.resolve();
        } else {
            this.locks.delete(id);
        }
    }
}