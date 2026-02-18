import {LinearBackoffStrategy} from '@deltic/backoff/linear';
import {AMQPConnectionProvider, ConnectionShuttingDown, UnableToEstablishConnection} from './connection-provider.js';

/**
 * Uses a valid but unreachable port to trigger connection failures
 * without causing Node.js ERR_SOCKET_BAD_PORT errors.
 */
const unreachableUrl = 'amqp://unused:unused@localhost:19999';

/**
 * Use a fast backoff for unit tests to avoid unnecessary waiting.
 */
const fastBackoff = new LinearBackoffStrategy(10);

describe('AMQPConnectionProvider', () => {
    test('requesting a connection after close throws ConnectionShuttingDown', async () => {
        const provider = new AMQPConnectionProvider(unreachableUrl);

        await provider.close();

        await expect(provider.connection()).rejects.toThrow(ConnectionShuttingDown);
    });

    test('a failed connection attempt allows retrying with the same identifier', async () => {
        let callCount = 0;
        const provider = new AMQPConnectionProvider(() => {
            callCount++;
            return [unreachableUrl];
        }, {backoff: fastBackoff});

        // First attempt should fail
        await expect(provider.connection('test', 150)).rejects.toThrow(UnableToEstablishConnection);

        // The waiter should be cleaned up, so a second call should try again (not return a stale rejection)
        await expect(provider.connection('test', 150)).rejects.toThrow(UnableToEstablishConnection);

        // The factory was called more than once, proving it retried
        expect(callCount).toBeGreaterThan(1);

        await provider.close();
    });

    test('closing during an active connection attempt causes it to reject', async () => {
        const provider = new AMQPConnectionProvider(unreachableUrl);

        // Start a connection attempt without timeout - it will loop until closed
        const connectionPromise = provider.connection('no-timeout');

        // Give it a moment to start trying
        await new Promise(resolve => setTimeout(resolve, 300));

        // Closing should cause the loop to exit
        await provider.close();

        await expect(connectionPromise).rejects.toThrow(UnableToEstablishConnection);
    });
});
