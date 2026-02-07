import {AsyncLocalStorage} from 'async_hooks';
import {Context} from '@deltic/context';
import {ContextMessageDecorator} from './context-decorator.js';
import {createMessage} from '@deltic/messaging/helpers';

type TestContext = {
    something: {
        deep: string;
        of: boolean;
    };
    other: string;
};

interface ExampleStream {
    aggregateRootId: string;
    messages: {
        example: object;
    };
}

describe('ContextMessageDecorator', () => {
    test('it decorates message headers with selected context keys', async () => {
        const storage = new AsyncLocalStorage<TestContext>();
        const context = new Context<TestContext>(storage);
        const decorator = new ContextMessageDecorator<ExampleStream, TestContext>(context, ['something']);

        await context.run(async () => {
            context.attach({
                something: {
                    deep: 'inside',
                    of: true,
                },
                other: 'value',
            });

            const message = createMessage<ExampleStream>('example', {});
            const decorated = decorator.decorate([message])[0];

            expect(decorated.headers['something']).toEqual({
                deep: 'inside',
                of: true,
            });
            expect(decorated.headers['other']).toBeUndefined();
        });
    });

    test('it skips keys that are not present in the context', async () => {
        const storage = new AsyncLocalStorage<TestContext>();
        const context = new Context<TestContext>(storage);
        const decorator = new ContextMessageDecorator<ExampleStream, TestContext>(context, ['something', 'other']);

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
            expect(decorated.headers).not.toHaveProperty('other');
        });
    });
});