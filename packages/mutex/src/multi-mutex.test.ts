import {MutexUsingMemory} from './memory-mutex.js';
import {MultiMutex} from './multi-mutex.js';
import {DynamicMutex, UnableToAcquireLock, UnableToReleaseLock} from './index.js';

const lockId = 'lock-id';

describe('MultiMutex', () => {
    let multi: DynamicMutex<string>;
    let first: DynamicMutex<string>;
    let second: DynamicMutex<string>;

    beforeEach(() => {
        multi = new MultiMutex<string>([
            first = new MutexUsingMemory<string>(),
            second = new MutexUsingMemory<string>(),
        ]);
    });

    test('locks cannot be acquired when an second mutex is already locked', async () => {
        await second.lock(lockId, 10);

        // cannot lock because the second mutex was already locked
        await expect(
            multi.lock(lockId, 100),
        ).rejects.toThrow(UnableToAcquireLock);

        // cannot be unlocked because the first mutex was never locked
        await expect(
            multi.unlock(lockId),
        ).rejects.toThrow(UnableToReleaseLock);
    });

    test('locks cannot be acquired when an first mutex is already locked', async () => {
        await first.lock(lockId, 10);

        // cannot lock because the first mutex was already locked
        await expect(
            multi.lock(lockId, 100),
        ).rejects.toThrow(UnableToAcquireLock);

        // cannot be unlocked because the second mutex was never locked
        await expect(
            multi.unlock(lockId),
        ).rejects.toThrow(UnableToReleaseLock);
    });
});
