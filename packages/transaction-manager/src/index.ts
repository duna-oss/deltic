export interface TransactionManager {
    begin(): Promise<void>,
    inTransaction(): boolean
    commit(): Promise<void>,
    abort(): Promise<void>,
}

export class NoopTransactionManager implements TransactionManager {
    async abort(): Promise<void> {
    }

    inTransaction(): boolean {
        return true;
    }

    async begin(): Promise<void> {
    }

    async commit(): Promise<void> {
    }
}