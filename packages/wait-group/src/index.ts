export type Waiter = () => void;

const resolveWaiter = (w: Waiter) => w();

export type WaitOptions = {
    timeout?: number;
    abortSignal?: AbortSignal,
}

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

    public async wait(options?: WaitOptions): Promise<void>;
    public async wait(timeout?: number, defaults?: WaitOptions): Promise<void>;
    public async wait(options: WaitOptions | number = {}, defaults: WaitOptions = {}): Promise<void> {
        let opts = typeof options === 'number'
            ? {...defaults, timeout: options} :
            {...defaults, ...options};

        if ((opts.timeout ?? -1) < 0) {
            opts.timeout = undefined;
        }

        opts = resolveOptions(opts);

        if (this.counter === 0) {
            return Promise.resolve();
        }

        const {resolve, promise, reject} = Promise.withResolvers<void>();
        this.waiters.push(resolve);

        opts.abortSignal?.addEventListener('abort', () => {
            reject(opts.abortSignal!.reason);
        }, {once: true});

        return promise;
    }
}

function resolveOptions(options: WaitOptions): WaitOptions {
    let abortSignal: AbortSignal | undefined = options.abortSignal;

    if (options.timeout !== undefined) {
        abortSignal = options.abortSignal
            ? AbortSignal.any([
                options.abortSignal,
                AbortSignal.timeout(options.timeout),
            ])
            : AbortSignal.timeout(options.timeout);
    }

    if (abortSignal?.aborted) {
        throw abortSignal.reason;
    }

    return {...options, abortSignal};
}
