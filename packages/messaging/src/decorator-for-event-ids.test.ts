import type {AnyMessageFrom} from './index.js';
import {MessageDecoratorForEventIds} from './decorator-for-event-ids.js';

describe('MessageDecoratorForEventIds', () => {
    interface SomeStream {
        aggregateRootId: string,
        messages: {
            example: 'hello',
        }
    }
    const decorator = new MessageDecoratorForEventIds<SomeStream>(() => 'whatever');

    test('it adds an event ID', () => {
        const message: AnyMessageFrom<SomeStream> = {
            type: 'example',
            headers: {},
            payload: 'hello',
        };

        const [decorated] = decorator.decorate([message]);

        expect(message.payload).toEqual('hello');
        expect(message.type).toEqual('example');
        expect(decorated.headers['event_id']).toEqual('whatever');
    });

    test('it does not override existing event IDs', () => {
        const message: AnyMessageFrom<SomeStream> = {
            type: 'example',
            headers: {
                event_id: 'existing',
            },
            payload: 'hello',
        };

        const [decorated] = decorator.decorate([message]);

        expect(message.payload).toEqual('hello');
        expect(message.type).toEqual('example');
        expect(decorated.headers['event_id']).toEqual('existing');
    });
});
