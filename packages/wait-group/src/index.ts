export type Waiter = () => void;

const resolveWaiter = (w: Waiter) => w();

export class WaitGroup {
    private counter: number = 0;
    private waiters: Waiter[] = [];

    public add(i: number = 1): void {
        this.counter += i;
    }

    public done(): void {
        if (this.counter === 0) {
            throw new Error('Unexpected WaitGroup.done, already at zero.');
        }

        this.counter -= 1;

        if (this.counter === 0) {
            this.waiters.forEach(resolveWaiter);
            this.waiters = [];
        }
    }

    public async wait(timeout: number = -1): Promise<void> {
        if (this.counter === 0) {
            return Promise.resolve();
        }

        const {resolve, promise, reject} = Promise.withResolvers<void>();
        this.waiters.push(resolve);

        if (timeout > -1) {
            setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== resolve);
                reject(new WaitGroupTimeoutExceeded('WaitGroup timeout exceeded'));
            }, timeout);
        }

        return promise;
    }
}

export class WaitGroupTimeoutExceeded extends Error{
}
