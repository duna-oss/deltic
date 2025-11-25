import type {AnyMessageFrom} from '@deltic/messaging';
import {
    AggregateRootBehavior,
    type AggregateRootOptions,
    type AggregateStream,
} from '@deltic/event-sourcing';

export abstract class AggregateRootUsingReducerFunc<
    Stream extends AggregateStream<Stream>,
    State,
> extends AggregateRootBehavior<Stream> {
    private _state: State;

    constructor(
        aggregateRootId: Stream['aggregateRootId'],
        initialState: State,
        options: AggregateRootOptions = {},
    ) {
        super(aggregateRootId, options);
        this._state = structuredClone(initialState);
    }

    protected get state(): State {
        return structuredClone(this._state);
    }

    protected abstract reduce(state: State, message: AnyMessageFrom<Stream>): State;

    protected apply(message: AnyMessageFrom<Stream>): void {
        this.aggregateRootVersionNumber = Number(message.headers['aggregate_root_version'] || 1);
        this._state = this.reduce(this._state, message);
    }
}