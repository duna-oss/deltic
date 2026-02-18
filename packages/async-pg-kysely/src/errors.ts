import {StandardError} from '@deltic/error-standard';

/**
 * Thrown when Kysely's built-in transaction methods are called on an instance
 * managed by this provider. Kysely's internal transaction management conflicts
 * with AsyncPgPool's transaction lifecycle — use the provider's own
 * transaction methods or TransactionManager instead.
 */
export class KyselyTransactionsNotSupported extends StandardError {
    static because = () =>
        new KyselyTransactionsNotSupported(
            'Kysely transactions are not supported. Use the provider transaction methods or TransactionManager instead.',
            'async-pg-kysely.transactions_not_supported',
        );
}
