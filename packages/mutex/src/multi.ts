import type {LockValue, DynamicMutex} from './index.js';

export class MultiMutex<LockID extends LockValue> implements DynamicMutex<LockID> {
    constructor(private readonly mutexes: DynamicMutex<LockID>[]) {
    }


    async lock(id: LockID, timeout?: number): Promise<void> {
        const start = process.hrtime.bigint();
        let timeLeft = timeout;
        const useTimeout = timeLeft !== undefined;
        const lockedMutexes: DynamicMutex<LockID>[] = [];

        for (const mutex of this.mutexes) {
            try {
                await mutex.lock(id, timeLeft);
                // unshift to unlock in reverse order
                lockedMutexes.unshift(mutex);

                if (useTimeout) {
                    timeLeft = timeLeft! - hrTimeToMs(process.hrtime.bigint() - start);
                }
            } catch (error) {
                for (const lockedMutex of lockedMutexes) {
                    await lockedMutex.unlock(id);
                }

                throw error;
            }
        }
    }

    async tryLock(id: LockID): Promise<boolean> {
        let locked: boolean = true;
        const lockedMutexes: DynamicMutex<LockID>[] = [];

        for (const mutex of this.mutexes) {
            try {
                if (await mutex.tryLock(id)) {
                    // unshift to unlock in reverse order
                    lockedMutexes.unshift(mutex);
                    continue;
                }
            } catch {
                // handle as failure
            }

            locked = false;
            break;
        }

        if (locked) {
            return true;
        }

        for (const lockedMutex of lockedMutexes) {
            await lockedMutex.unlock(id);
        }

        return false;
    }

    async unlock(id: LockID): Promise<void> {
        // Mutexes are unlocked in reverse order
        for (let i = this.mutexes.length - 1; i >= 0; i--) {
            const mutex = this.mutexes[i];
            await mutex.unlock(id);
        }
    }

}

export default function hrTimeToMs(hrtime: bigint) {
    return Number(hrtime / 1000000n);
}
