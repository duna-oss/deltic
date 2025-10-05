export type ErrorContext = { [index: string]: string | number | null | boolean };

export abstract class StandardError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context: ErrorContext = {},
        cause: unknown = undefined,
    ) {
        const options = cause === undefined ? undefined : {cause};
        super(message, options);
    }
}

export function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
