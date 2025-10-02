import {StaticMutex} from './index.js';
import {MutexUsingMemory} from './memory-mutex.js';

export class StaticMutexUsingMemory implements StaticMutex {
    private readonly mutex = new MutexUsingMemory<true>();

    tryLock(): Promise<boolean> {
        return this.mutex.tryLock(true);
    }

    lock(timeout?: number): Promise<void> {
        return this.mutex.lock(true, timeout);
    }

    unlock(): Promise<void> {
        return this.mutex.unlock(true);
    }
}