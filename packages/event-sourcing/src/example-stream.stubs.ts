import type {AnyMessageFrom} from '@deltic/messaging';
import {AggregateRootUsingReflectMetadata, makeEventHandler} from './using-reflect-metadata.js';
import {AggregateRootUsingHandlerMap, type HandlerMap} from './using-handler-map.js';
import type {AggregateRoot} from './index.js';
import {AggregateRootUsingReducerMap, type ReducerMap} from './using-reducer-map.js';
import {AggregateRootUsingReducerFunc} from './using-reducer-func.js';

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

export interface ExampleStream<Entity extends AggregateRoot<any>> {
    aggregateRoot: Entity;
    aggregateRootId: ExampleAggregateRootId;
    messages: {
        member_was_added: MemberWasAdded;
        member_was_removed: MemberWasRemoved;
        nothing_happened: string;
    };
}

const When = makeEventHandler<ExampleStream<any>>();

export class ExampleUsingReflectMetadata extends AggregateRootUsingReflectMetadata<
    ExampleStream<ExampleUsingReflectMetadata>
> {
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
        messages: AsyncGenerator<AnyMessageFrom<ExampleStream<ExampleUsingReflectMetadata>>>,
    ) {
        const aggregateRoot = new ExampleUsingReflectMetadata(id);

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }
}

export class ExampleUsingHandlerMap extends AggregateRootUsingHandlerMap<ExampleStream<ExampleUsingHandlerMap>> {
    private members: Map<string, Member> = new Map();
    private addedCounter: number = 0;

    protected readonly handlers: HandlerMap<ExampleStream<ExampleUsingHandlerMap>> = {
        member_was_added: event => {
            this.members.set(event.id, event);
            this.addedCounter++;
        },
        member_was_removed: event => {
            this.members.delete(event.id);
        },
    };

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

    get timesMemberWasAdded(): number {
        return this.addedCounter;
    }

    static async reconstituteFromEvents(
        id: ExampleAggregateRootId,
        messages: AsyncGenerator<AnyMessageFrom<ExampleStream<ExampleUsingHandlerMap>>>,
    ) {
        const aggregateRoot = new ExampleUsingHandlerMap(id);

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }
}

interface ExampleState {
    members: Record<string, Member>;
    addedCounter: number;
}

export class ExampleUsingReducerMap extends AggregateRootUsingReducerMap<
    ExampleStream<ExampleUsingReducerMap>,
    ExampleState
> {
    protected readonly handlers: ReducerMap<ExampleStream<ExampleUsingReducerMap>, ExampleState> = {
        member_was_added: (state, event) => {
            return {
                members: {
                    ...state.members,
                    [event.id]: event,
                },
                addedCounter: 1 + state.addedCounter,
            };
        },
        member_was_removed: (state, event) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {[event.id]: _, ...members} = state.members;
            return {
                ...state,
                members,
            };
        },
    };

    addMember(member: Member): void {
        if (!(member.id in this.state.members)) {
            this.recordThat('member_was_added', member);
        }
    }

    removeMember(id: string): void {
        if (id in this.state.members) {
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

    get timesMemberWasAdded(): number {
        return this.state.addedCounter;
    }

    static async reconstituteFromEvents(
        id: ExampleAggregateRootId,
        messages: AsyncGenerator<AnyMessageFrom<ExampleStream<ExampleUsingHandlerMap>>>,
    ) {
        const aggregateRoot = new ExampleUsingReducerMap(id, {
            members: {},
            addedCounter: 0,
        });

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }
}

export class ExampleUsingReducerFunc extends AggregateRootUsingReducerFunc<
    ExampleStream<ExampleUsingReducerFunc>,
    ExampleState
> {
    addMember(member: Member): void {
        if (!(member.id in this.state.members)) {
            this.recordThat('member_was_added', member);
        }
    }

    removeMember(id: string): void {
        if (id in this.state.members) {
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

    get timesMemberWasAdded(): number {
        return this.state.addedCounter;
    }

    static async reconstituteFromEvents(
        id: ExampleAggregateRootId,
        messages: AsyncGenerator<AnyMessageFrom<ExampleStream<ExampleUsingReducerFunc>>>,
    ) {
        const aggregateRoot = new ExampleUsingReducerFunc(id, {
            members: {},
            addedCounter: 0,
        });

        for await (const m of messages) {
            aggregateRoot.apply(m);
        }

        return aggregateRoot;
    }

    protected reduce(
        state: ExampleState,
        message: AnyMessageFrom<ExampleStream<ExampleUsingReducerFunc>>,
    ): ExampleState {
        if (message.type === 'member_was_added') {
            return {
                members: {
                    ...state.members,
                    [message.payload.id]: message.payload,
                },
                addedCounter: 1 + state.addedCounter,
            };
        } else if (message.type === 'member_was_removed') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {[message.payload.id]: _, ...members} = state.members;
            return {
                ...state,
                members,
            };
        }

        return state;
    }
}
