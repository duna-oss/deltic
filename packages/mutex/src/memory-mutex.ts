import {DynamicMutex, LockOptions, UnableToAcquireLock, UnableToReleaseLock} from './index.js';
import {maybeAbort, resolveOptions} from './abort-signal-options.js';

type LockWaiter = {done: boolean, promise: PromiseWithResolvers<void>};

export class MutexUsingMemory<LockID> implements DynamicMutex<LockID> {
    private readonly locks = new Map<LockID, true>();
    private waiters: LockWaiter[] = [];

    lock(id: LockID, options: LockOptions = {}): Promise<void> {
        const opt = resolveOptions(options);

        if (this.tryLockSync(id)) {
            return Promise.resolve();
        }

        const promise = Promise.withResolvers<void>();
        const lockWaiter: LockWaiter = {
            done: false,
            promise: promise,
        };
        this.waiters.push(lockWaiter);
        opt.abortSignal?.addEventListener('abort', (err: Event) => {
            promise.reject(err);
        });

        return promise.promise.then(
            () => {
                lockWaiter.done = true;
            },
            reason => {
                lockWaiter.done = true;
                throw UnableToAcquireLock.becauseOfError(reason);
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

    async tryLock(id: LockID, options: LockOptions): Promise<boolean> {
        maybeAbort(options.abortSignal);

        return this.tryLockSync(id);
    }

    async unlock(id: LockID): Promise<void> {
        if (!this.locks.get(id)) {
            throw new UnableToReleaseLock();
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