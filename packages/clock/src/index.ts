export type Timer<T = any> = PromiseLike<T> & {
    cancel(err: unknown): void;
    resolve(result: T): void;
}

type Callback<R = any> = () => R;

export interface Clock {
    now(): number;
    date(): Date;
    wait(timeout: number): Timer<void>;
    schedule(callback: Callback, timeout: number): Timer<void>;
}

export const SystemClock: Clock = {
    now: () => Date.now(),
    date: () => new Date(),
    wait(timeout: number): Timer<void> {
        const {promise, resolve, reject} = Promise.withResolvers<void>();
        const timer = setTimeout(resolve, timeout);

        return Object.defineProperty(promise as unknown as Timer<void>, 'cancel', {
            writable: false,
            value: (err?: unknown) => {
                clearTimeout(timer);

                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            },
        });
    },
    schedule<Return>(callback: Callback<Return>, timeout: number): Timer<Return> {
        let final: boolean = false;
        const {promise, resolve, reject} = Promise.withResolvers<Return>();
        const timer = setTimeout(async () => {
            final = true;
            const result: Return = await callback();
            resolve(result);
        }, timeout);

        return Object.defineProperty(promise as unknown as Timer<Return>, 'cancel', {
            writable: false,
            value: (err?: unknown) => {
                if (final) {
                    return;
                }

                clearTimeout(timer);
                final = true;
                reject(err);
            },
        });
    },
};

export interface TestClock extends Clock {
    tick(): void,
    advance(increment: number): void,
    travelTo(laterTime: number | string): void,
}

export const GlobalClock = process.env.NODE_ENV === 'test' ? createTestClock() : SystemClock;

type InternalTimer = {
    deadline: number,
    statement: DeferredStatement,
};

class DeferredStatement<Return = any> {
    private resolved: boolean = false;

    constructor(
        private readonly onResolve: Callback<void>,
        private readonly promise: PromiseWithResolvers<Return>,
    ) {}

    then<TResult1 = Return, TResult2 = never>(
        onFulfilled?: ((value: Return) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        this.resolve();

        return this.promise.promise.then(onFulfilled, onRejected);
    }

    resolve(): void {
        if (this.resolved === false) {
            this.resolved = true;
            this.onResolve();
        }
    }

    catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
    ): Promise<Return | TResult> {
        return this.then(undefined, onrejected);
    }

    cancel(error: unknown): void {
        this.resolved = true;
        this.promise.reject(error);
    }

    finally(onfinally?: (() => void) | null): Promise<Return> {
        return this.then(
            (value) => { onfinally?.(); return value; },
            (reason) => { onfinally?.(); throw reason; }
        );
    }
}

export function createTestClock(start: number | string = Date.now()): TestClock {
    let now = typeof start === 'number' ? start : Date.parse(start);
    const timers: InternalTimer[] = [];
    const processTimers = () => {
        timers.sort((a, b) => a.deadline - b.deadline);

        for (let index: number = 0; index < timers.length; index++) {
            const timer = timers[index];

            if (now >= timer.deadline) {
                timers.splice(index, 1);
                timer.statement.resolve();
            }
        }
    };

    const clock = {
        now: () => now,
        advance(increment: number): void {
            now += increment;
            processTimers();
        },
        date: () => new Date(now),
        tick(): void {
            ++now;
            processTimers();
        },
        travelTo(newTime: number | string): void {
            now = typeof newTime === 'number' ? newTime : Date.parse(newTime);
            processTimers();
        },
        wait(timeout: number): Timer<void> {
            const then = clock.now() + timeout;
            const promise = Promise.withResolvers<void>();
            const statement = new DeferredStatement(
                () => {
                    if (clock.now() <= then) {
                        clock.travelTo(then);
                    }
                    promise.resolve();
                },
                promise,
            );
            timers.push({
                deadline: timeout + now,
                statement,
            });

            try {
                return statement;
            } finally {
                processTimers();
            }
        },
        schedule<Result>(callback: Callback<Result>, timeout: number): Timer<Result> {
            const deadline = timeout + now;
            let resolved = false;
            const promise = Promise.withResolvers<Result>();
            const statement = new DeferredStatement<Result>(
                async () => {
                    if (resolved) {
                        return;
                    }

                    resolved = true;

                    if (clock.now() <= deadline) {
                        clock.advance(deadline);
                    }

                    promise.resolve(await callback());
                },
                promise,
            );
            const timer: InternalTimer = {
                deadline,
                statement,
            };
            timers.push(timer);

            try {
                return statement;
            } finally {
                processTimers();
            }
        }
    };

    return clock;
}

/**
 * Convert number of seconds into equivalent number of milliseconds
 */
export function secondsToMilliseconds(seconds: number): number {
    return seconds * 1000;
}

/**
 * Calculate how many milliseconds would be in the given number of days
 */
export function daysInMilliseconds(numberOfDays: number) {
    // There are 86,400,000 milliseconds in one day
    return 86_400_000 * numberOfDays;
}

/**
 * Calculate how many milliseconds would be in the given number of hours
 */
export function hoursInMilliseconds(numberOfHours: number) {
    // There are 3600,000 milliseconds in one hour
    return 3_600_000 * numberOfHours;
}

/**
 * Calculate how many milliseconds elapsed between startDate and endDate.
 *
 * @param startDate Must be earlier or equal to endDate
 * @param endDate Must be later or equal to startDate
 */
export function millisecondsBetween(startDate: number, endDate: number) {
    if (startDate > endDate) {
        throw new Error('Start time must be earlier than end time');
    }

    return endDate - startDate;
}
