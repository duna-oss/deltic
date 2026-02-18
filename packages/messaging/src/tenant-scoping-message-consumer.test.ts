import {ValueReadWriterUsingMemory} from '@deltic/context';
import type {MessageConsumer} from './index.js';
import {TenantScopingMessageConsumer} from './tenant-scoping-message-consumer.js';
import {createMessage} from './helpers.js';

interface ExampleStream {
    aggregateRootId: string;
    messages: {
        example: {name: string};
    };
}

describe('TenantScopingMessageConsumer', () => {
    test('it sets the tenant context from the message header', async () => {
        const tenantContext = new ValueReadWriterUsingMemory<string>();
        let capturedTenant: string | undefined;

        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {
                capturedTenant = tenantContext.resolve();
            },
        };

        const scoping = new TenantScopingMessageConsumer(tenantContext, consumer);
        const message = createMessage<ExampleStream>('example', {name: 'test'}, {
            aggregate_root_id: 'abc',
            tenant_id: 'acme',
        });

        await scoping.consume(message);

        expect(capturedTenant).toBe('acme');
    });

    test('it restores the original tenant context after consumption', async () => {
        const tenantContext = new ValueReadWriterUsingMemory<string>();
        tenantContext.use('original-tenant');

        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {},
        };

        const scoping = new TenantScopingMessageConsumer(tenantContext, consumer);
        const message = createMessage<ExampleStream>('example', {name: 'test'}, {
            aggregate_root_id: 'abc',
            tenant_id: 'other-tenant',
        });

        await scoping.consume(message);

        expect(tenantContext.resolve()).toBe('original-tenant');
    });

    test('it restores the original tenant context when consumption fails', async () => {
        const tenantContext = new ValueReadWriterUsingMemory<string>();
        tenantContext.use('original-tenant');

        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {
                throw new Error('consumption failed');
            },
        };

        const scoping = new TenantScopingMessageConsumer(tenantContext, consumer);
        const message = createMessage<ExampleStream>('example', {name: 'test'}, {
            aggregate_root_id: 'abc',
            tenant_id: 'other-tenant',
        });

        await expect(scoping.consume(message)).rejects.toThrow('consumption failed');
        expect(tenantContext.resolve()).toBe('other-tenant');
    });

    test('it sets undefined when the message has no tenant_id header', async () => {
        const tenantContext = new ValueReadWriterUsingMemory<string>();
        tenantContext.use('existing-tenant');
        let capturedTenant: string | undefined = 'not-called';

        const consumer: MessageConsumer<ExampleStream> = {
            async consume() {
                capturedTenant = tenantContext.resolve();
            },
        };

        const scoping = new TenantScopingMessageConsumer(tenantContext, consumer);
        const message = createMessage<ExampleStream>('example', {name: 'test'}, {
            aggregate_root_id: 'abc',
        });

        await scoping.consume(message);

        expect(capturedTenant).toBeUndefined();
    });
});
