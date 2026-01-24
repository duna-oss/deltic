import {AsyncLocalStorage} from 'async_hooks';
import {Context} from '@deltic/context';
import {ContextMessageDecorator} from './context-decorator.js';
import {createMessage} from '@deltic/messaging/helpers';

type TestContext = {
    something: {
        deep: string;
        of: boolean;
    };
};

interface ExampleStream {
    aggregateRootId: string;
    messages: {
        example: object;
    };
}

describe('ContextMessageDecorator', () => {
    test('it decorates message headers based on attached context', async () => {
        const storage = new AsyncLocalStorage<TestContext>();
        const context = new Context<TestContext>(storage);
        const decorator = new ContextMessageDecorator<ExampleStream, TestContext>(context);

        await context.run(async () => {
            context.attach({
                something: {
                    deep: 'inside',
                    of: true,
                },
            });

            const message = createMessage<ExampleStream>('example', {});
            const decorated = decorator.decorate([message])[0];

            expect(decorated.headers['something']).toEqual({
                deep: 'inside',
                of: true,
            });

            expect(context.get('something')).toEqual({
                deep: 'inside',
                of: true,
            });
        });
    });
});
