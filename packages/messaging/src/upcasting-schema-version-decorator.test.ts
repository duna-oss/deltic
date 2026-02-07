import {SchemaVersionMessageDecorator} from './upcasting.js';
import type {AnyMessageFrom, MessagesFrom} from './index.js';
import {
    type TestVersionedStream,
    testUpcasters,
    makeUserCreatedV3,
    makeUserDeleted,
} from './upcasting.stubs.js';

describe('SchemaVersionMessageDecorator', () => {
    let decorator: SchemaVersionMessageDecorator<TestVersionedStream>;

    beforeEach(() => {
        decorator = new SchemaVersionMessageDecorator(testUpcasters);
    });

    test('adds schema_version header to versioned messages', () => {
        // arrange
        const message = makeUserCreatedV3('john', 'john@test.com', 25);

        // act
        const [decorated] = decorator.decorate([message]);

        // assert
        expect(decorated.headers.schema_version).toBe(2); // 2 upcasters = version 2
    });

    test('does not add schema_version to non-versioned messages', () => {
        // arrange
        const message = makeUserDeleted('user-123');

        // act
        const [decorated] = decorator.decorate([message]);

        // assert
        expect(decorated.headers.schema_version).toBeUndefined();
    });

    test('decorates multiple messages correctly', () => {
        // arrange
        const messages: MessagesFrom<TestVersionedStream> = [
            makeUserCreatedV3('alice', 'alice@test.com', 30),
            makeUserDeleted('user-456'),
            makeUserCreatedV3('bob', 'bob@test.com', 25),
        ];

        // act
        const decorated = decorator.decorate(messages);

        // assert
        expect(decorated[0].headers.schema_version).toBe(2);
        expect(decorated[1].headers.schema_version).toBeUndefined();
        expect(decorated[2].headers.schema_version).toBe(2);
    });

    test('preserves existing headers when adding schema_version', () => {
        // arrange
        const message: AnyMessageFrom<TestVersionedStream> = {
            type: 'user_created',
            payload: {username: 'test', email: 'test@test.com', age: 20},
            headers: {
                aggregate_root_id: 'agg-123',
                aggregate_root_version: 5,
                custom_header: 'custom_value',
            },
        };

        // act
        const [decorated] = decorator.decorate([message]);

        // assert
        expect(decorated.headers.aggregate_root_id).toBe('agg-123');
        expect(decorated.headers.aggregate_root_version).toBe(5);
        expect(decorated.headers.custom_header).toBe('custom_value');
        expect(decorated.headers.schema_version).toBe(2);
    });
});
