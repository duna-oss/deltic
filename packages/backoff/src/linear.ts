import {type BackOffStrategy} from './index.js';

export class LinearBackoffStrategy implements BackOffStrategy {
    constructor(private readonly increment: number) {}

    backOff(attempt: number): number {
        return attempt * this.increment;
    }
}
