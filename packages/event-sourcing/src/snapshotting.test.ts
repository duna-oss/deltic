import {
    AggregateRootRepositoryWithSnapshotting,
    SnapshotRepositoryForTesting,
    type AggregateRootWithSnapshotting,
    type AggregateStreamWithSnapshotting,
    type Snapshot,
} from './snapshotting.js';
import type {AnyMessageFrom} from '@deltic/messaging';
import {createTestTooling} from './test-tooling.js';
import {MessageRepositoryUsingMemory} from '@deltic/messaging/repository-using-memory';
import {AggregateRootUsingReflectMetadata, makeEventHandler} from './using-reflect-metadata.js';

const When = makeEventHandler<SnapshottingTestEvents>();

type TestSnapshot = {total: number};

interface SnapshottingTestEvents extends AggregateStreamWithSnapshotting<SnapshottingTestEvents> {
    topic: 'testing';
    messages: {
        number_was_incremented: {
            by: number;
        };
    };
    aggregateRootId: string;
    aggregateRoot: SnapshottedEntity;
    snapshot: TestSnapshot;
}

class SnapshottedEntity
    extends AggregateRootUsingReflectMetadata<SnapshottingTestEvents>
    implements AggregateRootWithSnapshotting<SnapshottingTestEvents>
{
    private counter: number = 0;

    createSnapshot(): TestSnapshot {
        return {total: this.counter};
    }

    public increment(by: number): void {
        this.recordThat('number_was_incremented', {by});
    }

    @When('number_was_incremented')
    whenNumberWasIncremented(event: {by: number}): void {
        this.counter += event.by;
    }

    static async reconstituteFromEvents(id: string, messages: AsyncGenerator<AnyMessageFrom<SnapshottingTestEvents>>) {
        const aggregateRoot = new SnapshottedEntity(id);

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }

    static async reconstituteFromSnapshot(
        id: string,
        snapshot: Snapshot<SnapshottingTestEvents>,
        messages?: AsyncGenerator<AnyMessageFrom<SnapshottingTestEvents>>,
    ) {
        const aggregateRoot = new SnapshottedEntity(id);
        aggregateRoot.aggregateRootVersionNumber = snapshot.version;
        aggregateRoot.counter = snapshot.state.total;

        for await (const m of messages ?? []) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }
}

const aggregateRootId = 'not important';
const {createMessage} = createTestTooling<SnapshottingTestEvents>(aggregateRootId, SnapshottedEntity);

describe('snapshotting an event-sourced entity', () => {
    const snapshots = new SnapshotRepositoryForTesting<SnapshottingTestEvents>();
    const messages = new MessageRepositoryUsingMemory<SnapshottingTestEvents>();
    const repository = new AggregateRootRepositoryWithSnapshotting(SnapshottedEntity, snapshots, messages);

    afterEach(async () => {
        await snapshots.clear();
        messages.clear();
    });

    test('using a snapshot', async () => {
        // expect this message not to affect the total
        const message1 = createMessage(
            'number_was_incremented',
            {
                by: 5,
            },
            {
                aggregate_root_version: 2,
            },
        );

        // expect these to be played over the snapshot
        const message2 = createMessage(
            'number_was_incremented',
            {
                by: 5,
            },
            {
                aggregate_root_version: 3,
            },
        );
        const message3 = createMessage(
            'number_was_incremented',
            {
                by: 5,
            },
            {
                aggregate_root_version: 4,
            },
        );
        await messages.persist(aggregateRootId, [message1, message2, message3]);

        // persist a snapshot
        await snapshots.store({
            aggregateRootId,
            state: {total: 7},
            version: 2,
        });

        const entity = await repository.retrieve(aggregateRootId);
        const currentSnapshot = entity.createSnapshot();

        expect(currentSnapshot.total).toEqual(17);
    });

    test('storing a new snapshot', async () => {
        const entity = await repository.retrieve(aggregateRootId);
        entity.increment(7);
        entity.increment(8);

        await repository.persist(entity);

        const snapshot = await snapshots.retrieve(aggregateRootId);

        expect(snapshot?.version).toEqual(2);
        expect(snapshot?.state).toEqual({total: 15});
        expect(snapshot?.aggregateRootId).toEqual(aggregateRootId);
    });

    test('not storing a new snapshot', async () => {
        const entity = await repository.retrieve(aggregateRootId);
        entity.increment(7);
        entity.increment(8);

        await repository.persist(entity, false);

        const snapshot = await snapshots.retrieve(aggregateRootId);

        expect(snapshot).toEqual(undefined);
    });

    test('can return to correct version when there are no new events', async () => {
        await snapshots.store({
            aggregateRootId,
            state: {total: 44},
            version: 4,
        });

        const entity = await repository.retrieve(aggregateRootId);

        expect(entity.aggregateRootVersion()).toEqual(4);
    });

    test('new events continue version sequence after being restored from snapshot', async () => {
        await snapshots.store({
            aggregateRootId,
            state: {total: 44},
            version: 4,
        });

        const entity = await repository.retrieve(aggregateRootId);
        entity.increment(11);
        expect(entity.releaseEvents()[0].headers['aggregate_root_version']).toEqual(5);
    });
});
