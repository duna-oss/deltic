import 'reflect-metadata';
import {AggregateServiceDispatcher} from './aggregate-service-dispatcher.js';
import {
    ExampleAggregateRoot,
    type ExampleAggregateRootId,
    type ExampleStream,
    type Member,
} from './example-stream.stubs.js';
import {createTestTooling} from '@deltic/event-sourcing/test-tooling';
import {AggregateRepository} from '@deltic/event-sourcing';

interface ExampleCommand {
    id: ExampleAggregateRootId,
}

interface AddMember extends ExampleCommand {
    member: Member,
}

interface ExampleService {
    add: {payload: AddMember, response: string},
}

const {when, then, createMessage} = createTestTooling<ExampleStream, ExampleService>('abcde', ExampleAggregateRoot, createService);

function createService(context: {repository: AggregateRepository<ExampleStream>}) {
    return new AggregateServiceDispatcher<ExampleService, ExampleStream>({
        add: async (aggregate, input) => {
            aggregate.addMember(input.member);

            return input.member.id;
        },
    }, context.repository, (command: ExampleCommand) => command.id);
}

describe('AggregateServiceBus', () => {
    test('should fetch an aggregate and delegate to the handler', async () => {
        const frank = {
            id: '1234',
            name: 'Frank',
            age: 35,
        };
        const response = await when(
            'add',
            {
                id: 'aggregate-id',
                member: frank,
            },
        );

        expect(response).toBe('1234');

        then(
            createMessage('member_was_added', frank),
        );
    });
});
