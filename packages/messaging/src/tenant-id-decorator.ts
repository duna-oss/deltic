import type {MessageDecorator, MessagesFrom, StreamDefinition} from './index.js';
import type {ContextValueReader} from '@deltic/context';
import {messageWithHeader} from './helpers.js';

export class TenantIdMessageDecorator<
    Stream extends StreamDefinition,
    TenantId extends string | number = string | number,
> implements MessageDecorator<Stream> {
    constructor(private readonly tenantContext: ContextValueReader<TenantId>) {}

    decorate(messages: MessagesFrom<Stream>): MessagesFrom<Stream> {
        const tenantId = this.tenantContext.resolve();

        return tenantId === undefined
            ? messages
            : messages.map(m =>
                  messageWithHeader(m, {
                      key: 'tenant_id',
                      value: tenantId,
                  }),
              );
    }
}
