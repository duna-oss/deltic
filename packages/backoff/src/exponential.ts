import {type BackOffStrategy, MaxAttemptsExceeded} from './index.js';

export class ExponentialBackoffStrategy implements BackOffStrategy {
    constructor(
        private readonly initialDelayMs: number,
        private readonly maxAttempts: number,
        private readonly maxDelay: number = 2500000,
        private readonly base = 2.0,
    ) {}

    backOff(attempt: number): number {
        if (this.maxAttempts !== -1 && attempt > this.maxAttempts) {
            throw MaxAttemptsExceeded.atAttempt(attempt);
        }

        return Math.min(this.maxDelay, this.initialDelayMs * this.base ** (attempt - 1));
    }
}
