import {ExponentialBackoffStrategy} from './exponential.js';

describe('exponential backoff', () => {
    test.each([
        [1, 100],
        [2, 200],
        [3, 400],
        [4, 800],
        [5, 1600],
        [6, 3200],
        [7, 6400],
    ])('backs off exponentially', (tryNum, expectedDelay) => {
        const backoffStrategy = new ExponentialBackoffStrategy(100, 25, 250000, 2.0);

        expect(backoffStrategy.backOff(tryNum)).toEqual(expectedDelay);
    });

    test.each([
        [1, 100],
        [2, 200],
        [3, 400],
        [4, 600],
        [5, 600],
        [6, 600],
        [7, 600],
    ])('respects max delay', (tryNum, expectedDelay) => {
        const backoffStrategy = new ExponentialBackoffStrategy(100, 25, 600, 2.0);

        expect(backoffStrategy.backOff(tryNum)).toEqual(expectedDelay);
    });

    test.each([
        [10, 11],
        [10, 15],
        [100, 101],
        [100, 150],
    ])('returns undefined when max tries exceeded', (maxTries, tryNum) => {
        const backoffStrategy = new ExponentialBackoffStrategy(0, maxTries);

        expect(() => backoffStrategy.backOff(tryNum)).toThrow();
    });

    test.each([
        [2, 1.5, 150],
        [3, 1.5, 225],
        [2, 2.5, 250],
        [3, 2.5, 625],
    ])('uses a specified exponent value', (tryNum, exponent, expectedDelay) => {
        const backoffStrategy = new ExponentialBackoffStrategy(100, 100, 1000, exponent);

        expect(backoffStrategy.backOff(tryNum)).toEqual(expectedDelay);
    });

    test('can handle infinite max tries', () => {
        const backoffStrategy = new ExponentialBackoffStrategy(0, -1);

        backoffStrategy.backOff(Number.MAX_SAFE_INTEGER);
    });
});
