import {setTimeout as wait} from 'node:timers/promises';
import {
    createTestClock,
    daysInMilliseconds,
    millisecondsBetween,
    SystemClock,
    GlobalClock,
} from './index.js';

describe('@deltic/clock', () => {
    describe('clock.SystemClock', () => {
        it('should provide the system time', async () => {
            const clock = SystemClock;
            const before = Date.now();

            await wait(5); // ensure diff
            const now = clock.now();
            await wait(5); // ensure diff

            const after = Date.now();

            expect(now).toBeGreaterThan(before);
            expect(now).toBeLessThan(after);
        });
    });

    describe('clock.DefaultClock', () => {
        test('the default clock is a test clock in tests, so time is constant', async () => {
            const first = GlobalClock.now();

            await wait(5); // ensure diff

            expect(first).toEqual(GlobalClock.now());
        });
    });

    describe('clock.TestClock', () => {
        it('should provide a fixed time', () => {
            const clock = createTestClock(Date.parse('04 Dec 2022 15:30:45 GMT'));

            expect(clock.now()).toBe(1670167845000);
            clock.tick();
            expect(clock.now()).toBe(1670167845001);
        });

        it('should be able to jump ahead in time', () => {
            const clock = createTestClock(Date.parse('04 Dec 2022 15:30:45 GMT'));

            expect(clock.now()).toBe(1670167845000);
            clock.travelTo(Date.parse('09 Jan 2023 18:10:12 GMT'));
            expect(clock.now()).toBe(1673287812000);
        });

        it('should be able to go back in time', () => {
            const clock = createTestClock(Date.parse('04 Dec 2022 15:30:45 GMT'));

            expect(clock.now()).toBe(1670167845000);
            clock.travelTo(Date.parse('02 Nov 2021 18:10:12 GMT'));
            expect(clock.now()).toBe(1635876612000);
        });

        it('should be able to go back in time using a date string', () => {
            const clock = createTestClock('04 Dec 2022 15:30:45 GMT');

            expect(clock.now()).toBe(1670167845000);
            clock.travelTo('02 Nov 2021 18:10:12 GMT');
            expect(clock.now()).toBe(1635876612000);
        });

        it('can wait until a certain time', async () => {
            const clock = createTestClock(1000);
            const now = clock.now();

            const promise = clock.wait(1000);
            expect(clock.now()).toEqual(now);

            await promise;
            expect(clock.now()).toEqual(now + 1000);
        });

        it('waiting can be cancelled', async () => {
            const clock = createTestClock(1000);
            const now = clock.now();

            const promise = clock.wait(1000);
            promise.cancel('reason');

            await expect(promise).rejects.toThrow('reason');
            expect(clock.now()).toEqual(now);
        });

    });

    describe('clock.Helpers', () => {
        it('should calculate the number of milliseconds in a day', () => {
            expect(daysInMilliseconds(1)).toBe(86_400_000);
            expect(daysInMilliseconds(7)).toBe(604_800_000);
        });

        it('should calculate time between dates', () => {
            expect(millisecondsBetween(5, 8)).toEqual(3);
            expect(() => millisecondsBetween(8, 5)).toThrow(new Error('Start time must be earlier than end time'));
        });
    });
});
