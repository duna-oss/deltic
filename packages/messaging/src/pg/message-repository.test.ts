import {type AnyMessageFrom, AnyPayloadFromStream} from '../index.js';
import {MessageRepositoryUsingPg} from './message-repository.js';
import {Pool} from 'pg';
import * as uuid from 'uuid';
import {AsyncPgPool} from '@deltic/async-pg-pool';
import {pgTestCredentials} from '../../../pg-credentials.js';
import {SyncTenantContext} from '@deltic/context';
import {messageFactory} from '@deltic/messaging/helpers';
const firstTenantId = uuid.v7();
const secondTenantId = uuid.v7();
const tenantContext = new SyncTenantContext(firstTenantId);

interface ExampleEventStream {
    aggregateRootId: string,
    messages: {
        first: string,
        second: number,
    },
}

const createMessage = messageFactory<ExampleEventStream>();
const generateId = () => uuid.v7();
const id = generateId();

describe('MessageRepositoryUsingPg', () => {
    let repository: MessageRepositoryUsingPg<ExampleEventStream>;
    let pgPool: Pool;
    let asyncPool: AsyncPgPool;

    beforeAll(async () => {
        pgPool = new Pool(pgTestCredentials);

        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS test__message_repository (
                id BIGSERIAL PRIMARY KEY,
                tenant_id UUID,
                aggregate_root_id UUID NOT NULL,
                version SMALLINT NOT NULL,
                event_type VARCHAR(255) NOT NULL,
                payload JSON NOT NULL
            );
        `);
    });

    beforeEach(async () => {
        asyncPool = new AsyncPgPool(pgPool);
        repository = new MessageRepositoryUsingPg<ExampleEventStream>(
            asyncPool,
            'test__message_repository',
        );
    });

    afterAll(async () => {
        await pgPool.end();
    });

    afterEach(async () => {
        await asyncPool.flushSharedContext();
        await pgPool.query('TRUNCATE TABLE test__message_repository RESTART IDENTITY');
    });

    test('it stores and retrieves messages', async () => {
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first');
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2);
        await repository.persist(id, [firstMessage, secondMessage]);
        const retrievedPayloads: AnyPayloadFromStream<ExampleEventStream>[] = [];
        for await (const m of repository.retrieveAllForAggregate(id)) {
            retrievedPayloads.push(m.payload);
        }
        expect(retrievedPayloads).toHaveLength(2);

        const [firstRetrievedMessage, secondRetrievedMessage] = retrievedPayloads;
        expect(firstRetrievedMessage).toEqual(firstMessage.payload);
        expect(secondRetrievedMessage).toEqual(secondMessage.payload);
    });

    test('it exposes a stream ID', async () => {
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first');
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2);
        await repository.persist(id, [firstMessage, secondMessage]);
        const retrievedStreamIDs: number[] = [];
        for await (const m of repository.retrieveAllForAggregate(id)) {
            retrievedStreamIDs.push(Number(m.headers['stream_offset'] || 0));
        }
        expect(retrievedStreamIDs).toHaveLength(2);
        expect(retrievedStreamIDs).toEqual([1, 2]);
    });

    test.skip('it filters out based on tenant context', async () => {
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first');
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2);
        tenantContext.use(firstTenantId);
        await repository.persist(id, [firstMessage, secondMessage]);
        tenantContext.use(secondTenantId);
        const retrievedPayloads: AnyPayloadFromStream<ExampleEventStream>[] = [];

        // fetch as second tenant, get nothing
        for await (const m of repository.retrieveAllForAggregate(id)) {
            retrievedPayloads.push(m.payload);
        }
        expect(retrievedPayloads).toHaveLength(0);

        // fetch as first tenant, get the 2 messages
        tenantContext.use(firstTenantId);
        for await (const m of repository.retrieveAllForAggregate(id)) {
            retrievedPayloads.push(m.payload);
        }
        expect(retrievedPayloads).toHaveLength(2);
    });

    test('it retrieves nothing when nothing is stored', async () => {
        const retrievedMessages: AnyMessageFrom<ExampleEventStream>[] = [];
        for await (const m of repository.retrieveAllForAggregate(id)) {
            retrievedMessages.push(m);
        }
        expect(retrievedMessages).toHaveLength(0);
    });

    test('it retrieves messages after a specified version', async () => {
        // arrange
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first', {
            aggregate_root_version: 1,
        });
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2, {
            aggregate_root_version: 2,
        });
        await repository.persist(id, [firstMessage, secondMessage]);

        // act
        const retrievedPayloads: AnyPayloadFromStream<ExampleEventStream>[] = [];
        for await (const m of repository.retrieveAllAfterVersion(id, 1)) {
            retrievedPayloads.push(m.payload);
        }

        // assert
        expect(retrievedPayloads).toHaveLength(1);
        expect(retrievedPayloads[0]).toEqual(secondMessage.payload);
    });

    test('it can fetch messages between certain offsets', async () => {
        // arrange
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first', {
            aggregate_root_version: 1,
        });
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2, {
            aggregate_root_version: 2,
        });
        const thirdMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first', {
            aggregate_root_version: 3,
        });
        const fourthMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2, {
            aggregate_root_version: 4,
        });
        await repository.persist(id, [firstMessage, secondMessage, thirdMessage, fourthMessage]);

        // act
        const retrievedPayloads: AnyPayloadFromStream<ExampleEventStream>[] = [];
        for await (const m of repository.retrieveBetweenVersions(id, 1, 4)) {
            retrievedPayloads.push(m.payload);
        }

        // assert
        expect(retrievedPayloads).toHaveLength(2);
        expect(retrievedPayloads[0]).toEqual(secondMessage.payload);
        expect(retrievedPayloads[1]).toEqual(thirdMessage.payload);
    });

    test('it can fetch messages until a certain offset', async () => {
        // arrange
        const firstMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first', {
            aggregate_root_version: 1,
        });
        const secondMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2, {
            aggregate_root_version: 2,
        });
        const thirdMessage: AnyMessageFrom<ExampleEventStream> = createMessage('first', 'first', {
            aggregate_root_version: 3,
        });
        const fourthMessage: AnyMessageFrom<ExampleEventStream> = createMessage('second', 2, {
            aggregate_root_version: 4,
        });
        await repository.persist(id, [firstMessage, secondMessage, thirdMessage, fourthMessage]);

        // act
        const retrievedPayloads: AnyPayloadFromStream<ExampleEventStream>[] = [];
        for await (const m of repository.retrieveAllUntilVersion(id, 4)) {
            retrievedPayloads.push(m.payload);
        }

        // assert
        expect(retrievedPayloads).toHaveLength(3);
        expect(retrievedPayloads[0]).toEqual(firstMessage.payload);
        expect(retrievedPayloads[1]).toEqual(secondMessage.payload);
        expect(retrievedPayloads[2]).toEqual(thirdMessage.payload);
    });

    test('it can paginate over ids', async () => {
        /**
         * To ensure the retrieval mechanism does not skip IDs, the test data set emulates the sorting of
         * multiple concurrently running processes.
         */
        const ids = Array(10).fill(0).map(() => generateId() as ExampleEventStream['aggregateRootId']);
        const inserts = Array(3).fill(0).map((_value, i) => {
            return ids.map(id => ({id, message: createMessage('first', 'first', {
                aggregate_root_version: i + 1,
                aggregate_root_id: id,
            })}));
        }).flat();

        for (const {id, message} of inserts) {
            await repository.persist(id, [message]);
        }

        const paginated = repository.paginateIds(5, ids[1]);
        const collected: string[] = [];
        let lastVersion = 0;

        for await (const {id, version} of paginated) {
            collected.push(id);
            lastVersion = version;
        }

        expect(lastVersion).toEqual(3);
        expect(collected.length).toEqual(5);
        expect(collected).toEqual(ids.slice(2, 7));
    });
});
