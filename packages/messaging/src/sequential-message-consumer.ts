import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from './index.js';

interface ProcessFunc {
    (): Promise<void>;
}

interface ResolvablePromise<Response> {
    resolve: (response: Response | Promise<Response>) => void;
    reject: (reason?: any) => void;
}

/**
 * The sequential message consumer decorator ensures messages are processed in call-order, first
 * come, first processed. This decorator prevents consumers from having to protect against concurrent
 * execution.
 */
export class SequentialMessageConsumer<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    private queue: [ProcessFunc, ResolvablePromise<void>][] = [];
    private running: boolean = false;
    constructor(private readonly consumer: MessageConsumer<Stream>) {
        this.process = this.process.bind(this);
    }

    consume(message: AnyMessageFrom<Stream>): Promise<void> {
        const {promise, resolve, reject} = Promise.withResolvers<void>();
        this.queue.push([() => this.consumer.consume(message), {resolve, reject}]);

        if (this.queue.length === 1 && !this.running) {
            this.running = true;
            setImmediate(this.process);
        }

        return promise;
    }

    async process() {
        const [job, resolver] = this.queue.shift() || [];

        if (job === undefined || resolver === undefined) {
            this.running = false;
            return;
        }

        try {
            await job();
            resolver.resolve();
            setImmediate(this.process);
        } catch (e) {
            resolver.reject(e);
        }
    }
}
