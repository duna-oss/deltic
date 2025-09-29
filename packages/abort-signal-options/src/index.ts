export type AbortSignalOptions = {
    timeout?: number;
    abortSignal?: AbortSignal,
}

export function resolveOptions<Options extends AbortSignalOptions>(options: Options): Options {
    let abortSignal: AbortSignal | undefined = options.abortSignal;

    if (options.timeout !== undefined) {
        abortSignal = options.abortSignal
            ? AbortSignal.any([
                options.abortSignal,
                AbortSignal.timeout(options.timeout),
            ])
            : AbortSignal.timeout(options.timeout);
    }

    maybeAbort(abortSignal);

    return {...options, abortSignal};
}

export function maybeAbort(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw signal.reason;
    }
}