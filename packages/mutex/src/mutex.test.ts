import {setTimeout} from 'node:timers/promises';
import {MutexUsingMemory} from './memory-mutex.js';
import {MultiMutex} from './multi-mutex.js';
import {DynamicMutex, UnableToAcquireLock, UnableToReleaseLock} from './index.js';

const lockId1 = 'lock-id-1';

describe.each([
    [
        'Memory',
        () =>  new MutexUsingMemory<string>(),
    ],
    [
        'MultiMutex',
        () => new MultiMutex<string>([
            new MutexUsingMemory<string>(),
            new MutexUsingMemory<string>(),
        ])
    ],
] as const)('Mutex using %s', (_name, factory) => {
    let mutex: DynamicMutex<string>;

    beforeEach(() => {
        mutex = factory();
    });

    test('a lock can be acquired and released', async () => {
        expect.assertions(0);
        await mutex.lock(lockId1, {timeout: 100});
        await mutex.unlock(lockId1);
    });

    test('a tried lock can be acquired and released', async () => {
        const locked = await mutex.tryLock(lockId1, {timeout: 100});
        await mutex.unlock(lockId1);

        // assert
        expect(locked).toEqual(true);
    });

    test('a lock guarantees exclusive access when asked concurrently', async () => {
        const result: number[] = [];
        const promises: Promise<any>[] = [];

        for (let i = 0; i < 5; i++) {
            promises.push((async (index: number) => {
                await mutex.lock(lockId1, {timeout: 1000});
                result.push(index);
                await setTimeout(10 - i);
                result.push(index);
                await mutex.unlock(lockId1);
            })(i));
        }

        await Promise.all(promises);

        expect(result).toEqual([
            0, 0,
            1, 1,
            2, 2,
            3, 3,
            4, 4,
        ]);
    });

    test('acquiring a lock after a timeout', async () => {
        await mutex.tryLock(lockId1, {timeout: 100});

        await expect(mutex.lock(lockId1, {timeout: 100})).rejects.toThrow();

        await mutex.unlock(lockId1);

        await expect(mutex.lock(lockId1, {timeout: 100})).resolves.toEqual(undefined);

        await mutex.unlock(lockId1);
    });

    test('a lock cannot be acquired twice', async () => {
        // arrange
        await mutex.lock(lockId1, {timeout: 100});

        // act
        await expect(async () => {
            await mutex.lock(lockId1, {timeout: 1});
        }).rejects.toThrow(UnableToAcquireLock);

        // cleanup
        await mutex.unlock(lockId1);
    });

    test('a locked mutex can try but will not acquire a lock', async () => {
        // arrange
        await mutex.lock(lockId1, {timeout: 100});

        // act
        const locked = await mutex.tryLock(lockId1, {timeout: 100});


        // assert
        expect(locked).toBe(false);

        // cleanup
        await mutex.unlock(lockId1);
    });

    test('released locks can be acquired again', async () => {
        await mutex.lock(lockId1, {timeout: 100});

        expect(await mutex.tryLock(lockId1, {timeout: 100})).toEqual(false);

        await mutex.unlock(lockId1);

        expect(await mutex.tryLock(lockId1, {timeout: 100})).toEqual(true);

        // cleanup
        await mutex.unlock(lockId1);
    });

    test('locks that are not acquired cannot be released', async () => {
        await expect(async () => {
            await mutex.unlock(lockId1);
        }).rejects.toThrow(UnableToReleaseLock);
    });
});
