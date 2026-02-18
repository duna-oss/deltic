import {LinearBackoffStrategy} from './linear.js';

describe('linear backoff', () => {
    test.each([
        [1, 100],
        [2, 200],
        [3, 300],
        [4, 400],
        [5, 500],
        [6, 600],
        [7, 700],
    ])('backs off linearly', (tryNum, expectedDelay) => {
        const backoffStrategy = new LinearBackoffStrategy(100);

        expect(backoffStrategy.backOff(tryNum)).toEqual(expectedDelay);
    });
});
