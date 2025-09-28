export interface ResolveFunc<T> {
    (t: T | PromiseLike<T>): void,
}

export interface RejectFunc {
    (reason?: any): void
}

export interface ProcessStackItem<Task> {
    processing?: boolean,
    partitionKey?: string,
    promise: Promise<Task>,
    task: Task,
    resolve: ResolveFunc<Task>,
    reject: RejectFunc,
}
