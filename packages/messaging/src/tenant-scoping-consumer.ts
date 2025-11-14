import type {AnyMessageFrom, MessageConsumer, StreamDefinition} from './index.js';
import type {TenantContextWriter} from '@deltic/context';

export class TenantScopingMessageConsumer<Stream extends StreamDefinition> implements MessageConsumer<Stream> {
    constructor(
        private readonly tenantContext: TenantContextWriter<string>,
        private readonly consumer: MessageConsumer<Stream>,
    ) {
    }

    async consume(message: AnyMessageFrom<Stream>): Promise<void> {
        const tenantId = message.headers['tenant_id'] as string | undefined;
        const originalTenant = this.tenantContext.resolve();
        this.tenantContext.use(tenantId);
        await this.consumer.consume(message);
        this.tenantContext.use(originalTenant);
    }
}
