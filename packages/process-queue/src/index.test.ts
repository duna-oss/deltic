import {
    ConcurrentProcessQueue,
    PartitionedProcessQueue,
    type ProcessQueue,
    type ProcessQueueOptions,
    SequentialProcessQueue,
} from './index.js';
import {WaitGroup} from '@deltic/wait-group';

type Factory = <T>(options: ProcessQueueOptions<T>) => ProcessQueue<T>;

const createSequentialProcessor = <T>(options: ProcessQueueOptions<T>): ProcessQueue<T> =>
    new SequentialProcessQueue<T>(options);

const createConcurrentProcessor = <T>(options: ProcessQueueOptions<T>): ProcessQueue<T> =>
    new ConcurrentProcessQueue<T>(options);

const createPartitionedProcessor = <T>(options: ProcessQueueOptions<T>): ProcessQueue<T> => {
    const {onStop, ...rest} = options;

    return new PartitionedProcessQueue<T>(
        () => new SequentialProcessQueue<T>(rest),
        () => 0,
        1,
        onStop,
    );
};

describe.each([
    ['sequential', createSequentialProcessor],
    ['concurrent', createConcurrentProcessor],
    ['partitioned', createPartitionedProcessor],
])('@deltic/process-queue %s', (_type: string, factory: Factory) => {
    test('pushing a task on the queue returns a promise that resolves the task when completed', async () => {
        const processor = new AppendingProcessor();
        const processQueue = factory({
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: processor.process,
        });
        const task = await processQueue.push('a');
        expect(task).toEqual('a');
        await processQueue.stop();
    });

    test('it supports not auto starting', async () => {
        const processor = new AppendingProcessor();
        const processQueue = factory({
            autoStart: false,
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: processor.process,
        });

        expect(processQueue.isProcessing()).toEqual(false);
    });

    test('it can be started manually', async () => {
        const processor = new AppendingProcessor();
        const {promise, resolve} = Promise.withResolvers<void>();
        let count = 0;
        const processQueue: ProcessQueue<string> = factory({
            autoStart: false,
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: async value => {
                await processor.process(value);
                count++;

                if (count >= 3) {
                    resolve();
                }
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        processQueue.push('c');
        processQueue.start();
        await promise;
        expect(processor.value).toContain('a');
        expect(processor.value).toContain('b');
        expect(processor.value).toContain('c');
    });

    test('it calls an onError hook that receives thrown errors', async () => {
        const {promise, resolve} = Promise.withResolvers<void>();
        let errors = 0;
        const processQueue = factory({
            stopOnError: true,
            onError: async () => {
                errors = 1;
                resolve();
            },
            processor: async () => {
                throw new Error('no!');
            },
        });
        processQueue.push('a').catch(() => {});
        await promise;
        expect(errors).toEqual(1);
    });

    test('it calls an onError hook when a promise is rejected', async () => {
        const promise = Promise.withResolvers<void>();
        let errors = 0;
        const processQueue = factory({
            onError: async ({queue}) => {
                errors++;
                await queue.stop();
                promise.resolve();
            },
            processor: () => Promise.reject(new Error('reason')),
        });
        processQueue.push('a').catch(() => {});
        await promise.promise;
        expect(errors).toEqual(1);
    });

    test('a task can be skipped on error', async () => {
        let tries = 0;
        const {promise, resolve} = Promise.withResolvers<void>();
        const processQueue = factory({
            onError: async ({skipCurrentTask}) => {
                skipCurrentTask();
            },
            onDrained: async () => {
                resolve();
            },
            processor: async () => {
                tries++;
                throw new Error('failing');
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        await promise;
        await processQueue.stop();
        expect(tries).toEqual(2);
    });

    test('skipping on error rejects the promise', async () => {
        const processQueue = factory({
            onError: async ({skipCurrentTask}) => {
                skipCurrentTask();
            },
            processor: async () => {
                throw new Error('failing');
            },
        });

        await expect(processQueue.push('a')).rejects.toEqual(new Error('failing'));
        await processQueue.stop();
    });

    test('stopping the queue in the same event loop cycle prevents tasks from being processed', async () => {
        let processed = 0;
        const processQueue = factory({
            onError: async ({skipCurrentTask}) => {
                skipCurrentTask();
            },
            processor: async () => {
                processed++;
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        await processQueue.stop();
        expect(processed).toEqual(0);
    });

    test('purging prevents the next task(s) from being handled', async () => {
        let tries = 0;
        const processQueue = factory({
            onError: async () => {},
            processor: async () => {
                tries++;
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        await processQueue.purge();
        expect(tries).toEqual(0);
    });

    test('when a job is completed the onFinish hook is called', async () => {
        let called = false;
        const {promise, resolve} = Promise.withResolvers<void>();
        const processQueue = factory({
            onError: async () => {},
            onFinish: async () => {
                called = true;
                resolve();
            },
            processor: async () => {},
        });
        processQueue.push('something');
        await promise;
        expect(called).toBe(true);
    });

    test('when a job errors the onFinish hook is NOT called', async () => {
        let called = false;
        const {promise, resolve} = Promise.withResolvers<void>();
        const processQueue = factory({
            onError: async () => {
                resolve();
            },
            onFinish: async () => {
                called = true;
            },
            processor: async () => {
                throw new Error('oh no');
            },
        });
        processQueue.push('something').catch(() => {});
        await promise;
        await processQueue.stop();
        expect(called).toBe(false);
    });
});

describe('@deltic/process-queue SequentialProcessQueue', () => {
    test('stopping the queue waits on the current job in progress', async () => {
        const result: string[] = [];
        const processQueue = new SequentialProcessQueue<string>({
            onError: async () => {},
            processor: async (task: string) => {
                result.push(task);
                await wait(5);
                result.push(task);
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        await wait(8);
        await processQueue.stop();
        expect(result).toEqual(['a', 'a', 'b', 'b']);
    });

    test('the queue processes items in order', async () => {
        const waitGroup = new WaitGroup();
        waitGroup.add(3);
        const processor = new AppendingProcessor();
        const processQueue = new SequentialProcessQueue({
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: async (task: string) => {
                await processor.process(task);
                waitGroup.done();
            },
        });
        processQueue.push('a');
        processQueue.push('b');
        processQueue.push('c');
        await waitGroup.wait(100);
        expect(processor.value).toEqual('abc');
        await processQueue.stop();
    });
});

describe('@deltic/process-queue ConcurrentProcessQueue', () => {
    test('the queue processes items in order', async () => {
        const processor = new WaitingProcessor();
        const processQueue = new ConcurrentProcessQueue({
            maxProcessing: 100,
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: processor.process,
        });
        processQueue.push(20);
        processQueue.push(15);
        processQueue.push(5);
        await processQueue.push(25);
        expect(processor.values).toHaveLength(4);
        expect(processor.values[0]).toEqual(5);
        expect(processor.values[1]).toEqual(15);
        expect(processor.values[2]).toEqual(20);
        expect(processor.values[3]).toEqual(25);
        await processQueue.stop();
    });

    test('stopping the queue waits for all tasks in progress', async () => {
        const processor = new WaitingProcessor();
        const processQueue = new ConcurrentProcessQueue({
            maxProcessing: 100,
            onError: async () => {
                throw new Error('No error handler defined');
            },
            processor: processor.process,
        });
        processQueue.push(45);
        processQueue.push(55);
        processQueue.push(35);
        await wait(5);
        await processQueue.stop();
        expect(processor.values).toEqual([35, 45, 55]);
    });
});

class WaitingProcessor {
    public values: number[] = [];

    constructor() {
        this.process = this.process.bind(this);
    }

    public async process(value: number): Promise<void> {
        await wait(value);
        this.values.push(value);
    }
}

const wait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

class AppendingProcessor {
    public value: string = '';

    constructor() {
        this.process = this.process.bind(this);
    }

    public async process(value: string): Promise<void> {
        this.value = this.value.concat(value);
    }
}
