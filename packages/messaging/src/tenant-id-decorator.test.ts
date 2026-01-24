import type {AnyMessageFrom} from './index.js';
import {TenantIdMessageDecorator} from './tenant-id-decorator.js';
import {SyncTenantContext} from '@deltic/context';

describe('TenantIdMessageDecorator', () => {
    test('it adds the tenant id when it is known in the context', async () => {
        // arrange
        interface Example {
            aggregateRootId: string;
            messages: {
                something: number;
            };
        }
        const context = new SyncTenantContext<string>();
        const decorator = new TenantIdMessageDecorator<Example>(context);
        const message: AnyMessageFrom<Example> = {
            type: 'something',
            headers: {},
            payload: 1234,
        };

        // act
        const decoratedMessage1 = decorator.decorate([message])[0];
        context.use('4321');
        const decoratedMessage2 = decorator.decorate([message])[0];

        // assert
        expect(decoratedMessage1.headers['tenant_id']).toBe(undefined);
        expect(decoratedMessage2.headers['tenant_id']).toBe('4321');
    });
});
