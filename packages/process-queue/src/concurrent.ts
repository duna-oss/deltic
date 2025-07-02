import {type ProcessQueue, ProcessQueueDefaults, ProcessQueueOptions} from './api.js';
import {type ProcessStackItem} from './internals.js';
import {WaitGroup} from '@typic/wait-group';
import {exposedPromise} from '@typic/exposed-promise';

export class ConcurrentProcessQueue<Task> implements ProcessQueue<Task> {
    private stack: ProcessStackItem<Task>[] = [];
    private running: boolean = true;
    private processing: number = 0;
    private timer: any | false = false;
    private config: Required<ProcessQueueOptions<Task>>;
    private maxProcessing: number;
    private waitGroup: WaitGroup = new WaitGroup();

    public constructor(
        options: ProcessQueueOptions<Task>,
    ) {
        this.config = {...ProcessQueueDefaults, ...options};
        this.processNextTask = this.processNextTask.bind(this);
        this.skipCurrentTask = this.skipCurrentTask.bind(this);
        this.running = this.config.autoStart;
        this.maxProcessing = this.config.maxProcessing;
    }

    public async purge() {
        await this.stop();
        this.stack = [];
    }

    public start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.scheduleNextTask();
    }

    private scheduleNextTask(): void {
        /* istanbul ignore else  */
        if (this.running && this.timer === false && this.processing < this.maxProcessing) {
            this.timer = setImmediate(this.processNextTask);
        }
    }

    private skipCurrentTask(item: ProcessStackItem<Task>): void {
        item.promise.catch(() => {});
        this.stack = this.stack.filter(i => i !== item);
    }

    private processNextTask(): void {
        this.timer = false;
        const next = this.stack.find(i => i.processing !== true);
        /* istanbul ignore else  */
        if (next !== undefined) {
            this.waitGroup.add();
            next.processing = true;
            this.processing++;
            next.tries++;
            const promise = this.config.processor.apply(null, [next.task]);
            promise.then(() => {
                this.handleProcessorResult(undefined, next as ProcessStackItem<Task>);
            }).catch((err: Error) => {
                this.handleProcessorResult(err, next  as ProcessStackItem<Task>);
            });

            this.scheduleNextTask();
        }
    }

    public push(task: Task): Promise<Task> {
        const {reject, resolve, promise} = exposedPromise<Task>();
        this.stack.push({task, promise, reject, resolve, tries: 0} );

        if (this.stack.length === 1 && this.running) {
            this.scheduleNextTask();
        }

        return promise;
    }

    private async handleProcessorResult(err: Error | undefined, item: ProcessStackItem<Task>): Promise<void> {
        this.processing--;
        item.processing = false;
        const {task, resolve, reject, tries} = item;

        if (err) {
            await this.config.onError({error: err, task, tries, queue: this, skipCurrentTask: () => this.skipCurrentTask(item)});
            reject(err);
        } else {
            this.stack = this.stack.filter(i => i !== item);
            await this.config.onFinish.apply(null, [task]);
            resolve(task);
        }

        if (this.stack.length === 0) {
            await this.config.onDrained.apply(null, [this]);
        } else if (this.running) {
            this.scheduleNextTask();
        }

        this.waitGroup.done();
    }

    public stop(): Promise<void> {
        this.running = false;
        clearImmediate(this.timer);

        if (this.processing === 0) {
            return Promise.resolve();
        }

        return this.waitGroup.wait();
    }
}
