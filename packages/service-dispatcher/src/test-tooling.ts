import type {
    AnyInputForService,
    Service,
    ServiceStructure,
} from './index.js';
import {deepEqual} from 'fast-equals';

type StagedResponse<Definition extends ServiceStructure<Definition>> = {
    [Type in keyof Definition]: {
        readonly type: Type,
        readonly payload?: Definition[Type]['payload'],
        readonly response?: Definition[Type]['response'],
        readonly error?: Error,
    }
};

export type AnyStagedResponse<Definition extends ServiceStructure<Definition>> = StagedResponse<Definition>[keyof StagedResponse<Definition>];

function shouldRespondTo<
    Service extends ServiceStructure<Service>,
    Type extends keyof Service,
>(input: AnyInputForService<Service>, stagedResponse: AnyStagedResponse<Service>): stagedResponse is StagedResponse<Service>[Type] {
    if (input.type !== stagedResponse.type) {
        return false;
    }

    if (stagedResponse.payload === undefined) {
        return true;
    }

    return deepEqual(stagedResponse.payload, input.payload);
}

/**
 * @internal
 */
export function errorForMissingMockedResponseForInput(input: object) {
    return new Error(`No mocked response for input: ${JSON.stringify(input)}`);
}

export class MockedService<Definition extends ServiceStructure<Definition>> implements Service<Definition> {
    private stagedResponses: AnyStagedResponse<Definition>[] = [];
    private calledWith: AnyInputForService<Definition>[] = [];

    public async handle<T extends keyof Definition>(
        type: T,
        payload: Definition[T]['payload'],
    ): Promise<Definition[T]['response']> {
        const input: AnyInputForService<Definition> = {type, payload};
        this.calledWith.push(input);

        for (let i = 0; i < this.stagedResponses.length; i++) {
            const response = this.stagedResponses.at(i);

            if (!response) {
                continue;
            }

            if (shouldRespondTo(input, response)) {
                this.stagedResponses.splice(i, 1);

                if (response.error) {
                    throw response.error;
                }

                return response.response;
            }
        }

        throw errorForMissingMockedResponseForInput(input);
    }

    stageResponse<T extends keyof Definition>(
        response: StagedResponse<Definition>[T],
    ): void {
        this.stagedResponses.push(response);
    }

    wasCalledWith(input: AnyInputForService<Definition>, times: number = 1): boolean {
        return this.timeCalledWith(input) === times;
    }

    timeCalledWith(input: AnyInputForService<Definition>): number {
        return this.calledWith.filter(call => deepEqual(input, call)).length;
    }

    timesCalled(): number {
        return this.calledWith.length;
    }

    wasCalled(): boolean {
        return this.timesCalled() > 0;
    }

    reset() {
        this.stagedResponses = [];
        this.calledWith = [];
    }
}
