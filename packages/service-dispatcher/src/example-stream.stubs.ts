import type {AnyMessageFrom} from '@deltic/messaging';
import {AggregateRootUsingReflectMetadata, makeEventHandler} from '@deltic/event-sourcing/using-reflect-metadata';

export interface Member {
    readonly id: string;
    readonly name: string;
    readonly age: number;
}

export interface MemberWasAdded {
    readonly id: string;
    readonly name: string;
    readonly age: number;
}

export interface MemberWasRemoved {
    readonly id: string;
}

export type ExampleAggregateRootId = string;

export interface ExampleStream {
    aggregateRoot: ExampleAggregateRoot;
    aggregateRootId: ExampleAggregateRootId;
    messages: {
        member_was_added: MemberWasAdded;
        member_was_removed: MemberWasRemoved;
        nothing_happened: string;
    };
}

const When = makeEventHandler<ExampleStream>();

export class ExampleAggregateRoot extends AggregateRootUsingReflectMetadata<ExampleStream> {
    private members: Map<string, Member> = new Map();
    private addedCounter: number = 0;

    addMember(member: Member): void {
        if (!this.members.has(member.id)) {
            this.recordThat('member_was_added', member);
        }
    }

    removeMember(id: string): void {
        if (this.members.has(id)) {
            this.recordThat(
                'member_was_removed',
                {id},
                {
                    time_of_recording: 'now',
                    time_of_recording_ms: 0,
                },
            );
        }
    }

    public recordInsignificantEvent(value: string): void {
        this.recordThat('nothing_happened', value);
    }

    public throwAnError(error: Error): void {
        throw error;
    }

    @When('member_was_added')
    protected whenMemberWasAdded(event: MemberWasAdded) {
        this.members.set(event.id, event);
    }

    @When('member_was_added')
    protected countMembersAdded() {
        this.addedCounter++;
    }

    get timesMemberWasAdded(): number {
        return this.addedCounter;
    }

    @When('member_was_removed')
    protected whenMemberWasRemoved(event: MemberWasRemoved) {
        this.members.delete(event.id);
    }

    static async reconstituteFromEvents(
        id: ExampleAggregateRootId,
        messages: AsyncGenerator<AnyMessageFrom<ExampleStream>>,
    ) {
        const aggregateRoot = new ExampleAggregateRoot(id);

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }
}
