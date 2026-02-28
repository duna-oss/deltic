import {StandardError} from '@deltic/error-standard';

export interface BackOffStrategy {
    // Returns the delay to use for the next try, or undefined if max tries has been exceeded
    backOff: (attempt: number) => number;
}

export class MaxAttemptsExceeded extends StandardError {
    static atAttempt = (attempt: number) =>
        new MaxAttemptsExceeded('Max attempts exceeded', 'backoff_strategy.error.max_attempts_exceeded', {attempt});
}
