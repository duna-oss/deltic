import {
    type StaticMutex,
    UnableToAcquireLock,
    UnableToReleaseLock,
} from './index.js';
import {StaticMutexUsingMemory} from './static-memory-mutex.js';

let mutex: StaticMutex;

describe.each([
    ['Memory', () => new StaticMutexUsingMemory()],
])('Mutex using %s', (_name, factory) => {
    beforeEach(() => {
        mutex = factory();
    });

    test('a lock can be acquired and released', async () => {
        expect.assertions(0);
        await mutex.lock(100);
        await mutex.unlock();
    });

    test('a tried lock can be acquired and released', async () => {
        const locked = await mutex.tryLock();
        await mutex.unlock();

        // assert
        expect(locked).toEqual(true);
    });

    test('a lock cannot be acquired twice', async () => {
        // arrange
        await mutex.lock(100);

        // act
        await expect(
            mutex.lock(1),
        ).rejects.toThrow(UnableToAcquireLock);

        // cleanup
        await mutex.unlock();
    });

    test('a locked mutex can try but will not acquire a lock', async () => {
        // arrange
        await mutex.lock(100);

        // act
        const locked = await mutex.tryLock();


        // assert
        expect(locked).toBe(false);

        // cleanup
        await mutex.unlock();
    });

    test('released locks can be acquired again', async () => {
        await mutex.lock(100);

        expect(await mutex.tryLock()).toEqual(false);

        await mutex.unlock();

        expect(await mutex.tryLock()).toEqual(true);

        // cleanup
        await mutex.unlock();
    });

    test('locks that are not acquired cannot be released', async () => {
        await expect(
            mutex.unlock(),
        ).rejects.toThrow(UnableToReleaseLock);
    });
});
