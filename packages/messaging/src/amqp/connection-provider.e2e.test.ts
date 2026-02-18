import {AMQPConnectionProvider} from './connection-provider.js';

const amqpUrl = 'amqp://admin:admin@localhost:35671';

describe('AMQPConnectionProvider', () => {
    test('it can resolve a connection', async () => {
        const connectionProvider = new AMQPConnectionProvider(amqpUrl);

        try {
            const connection = await connectionProvider.connection();

            expect(connection).not.toBeUndefined();
        } finally {
            await connectionProvider.close();
        }
    });

    test('it can resolve the same connection twice', async () => {
        const connectionProvider = new AMQPConnectionProvider(amqpUrl);

        try {
            const connection1 = await connectionProvider.connection();
            const connection2 = await connectionProvider.connection();

            expect(connection1).toBe(connection2);
        } finally {
            await connectionProvider.close();
        }
    });

    test('it can resolve two different connections that are not the same', async () => {
        const connectionProvider = new AMQPConnectionProvider(amqpUrl);

        try {
            const connection1 = await connectionProvider.connection('one');
            const connection2 = await connectionProvider.connection('two');

            expect(connection1).not.toBe(connection2);
        } finally {
            await connectionProvider.close();
        }
    });

    test('it errors when no connection is successfully resolved', async () => {
        const connectionProvider = new AMQPConnectionProvider('amqp://admin:invalid@localhost:35671');

        await expect(() => connectionProvider.connection(undefined, 50)).rejects.toThrow();

        await connectionProvider.close();
    });

    test('it can resolve a working connection even when one of the URLs is invalid', async () => {
        const connectionProvider = new AMQPConnectionProvider(
            () => ['amqp://admin:invalid@localhost:35671', amqpUrl],
        );

        try {
            const connection = await connectionProvider.connection();

            expect(connection).not.toBeUndefined();
        } finally {
            await connectionProvider.close();
        }
    });
});
