import {type ProcessQueue, ProcessQueueDefaults, ProcessQueueOptions} from './api.js';
import {type ProcessStackItem} from './internals.js';

export class SequentialProcessQueue<Task> implements ProcessQueue<Task>{
    private nextTick: undefined | (() => void) = undefined;
    private tasks: ProcessStackItem<Task>[] = [];
    private running: boolean = true;
    private processing: boolean = false;
    private timer: any | false = false;
    private config: Required<ProcessQueueOptions<Task>>;

    public constructor(
        options: ProcessQueueOptions<Task>,
    ) {
        this.config = {...ProcessQueueDefaults, ...options};
        this.processNextTask = this.processNextTask.bind(this);
        this.skipCurrentTask = this.skipCurrentTask.bind(this);
        this.running = this.config.autoStart;
    }

    public async purge() {
        await this.stop();
        this.tasks = [];
    }

    public start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.scheduleNextTask();
    }

    private scheduleNextTask(): void {
        this.timer = setImmediate(this.processNextTask);
    }

    private skipCurrentTask(): void {
        const item = this.tasks.shift();

        /* istanbul ignore else  */
        if (item !== undefined) {
            item.promise.catch(() => {});
        }
    }

    private processNextTask(): void {
        if (this.tasks.length > 0) {
            this.processing = true;
            this.tasks[0].tries++;
            const promise = this.config.processor.apply(null, [this.tasks[0].task]);
            promise.then(
                () => {
                    this.handleProcessorResult(undefined);
                },
            ).catch((err: Error) => {
                this.handleProcessorResult(err);
            });
        }
    }

    public push(task: Task): Promise<Task> {
        const {promise, reject, resolve} = Promise.withResolvers<Task>();

        this.tasks.push({task, promise, reject, resolve, tries: 0} );

        if (this.tasks.length === 1 && this.running) {
            this.scheduleNextTask();
        }

        return promise;
    }

    private async handleProcessorResult(err: unknown): Promise<void> {
        this.processing = false;
        const {task, resolve, reject, tries} = this.tasks[0];

        if (err) {
            await this.config.onError(({error: err, task, tries, queue: this, skipCurrentTask: this.skipCurrentTask}));
            reject(err);
        } else {
            this.tasks.shift();
            await this.config.onFinish.apply(null, [task]);
            resolve(task);
        }

        if (this.nextTick) {
            this.nextTick.apply(null);
            this.nextTick = undefined;
        }

        if (this.tasks.length === 0) {
            this.config.onDrained.apply(null, [this]);
        } else if (this.running) {
            this.scheduleNextTask();
        }
    }

    public stop(): Promise<void> {
        this.running = false;

        if (this.timer !== false) {
            clearImmediate(this.timer);
        }

        if (!this.processing) {
            return Promise.resolve();
        }

        return new Promise<void>(resolve => this.nextTick = () => resolve());
    }
}
