import {ServiceDispatcher} from './index.js';

interface NumberToNumber {
    value: number;
}

interface UppercaseResponse {
    value: string;
}

interface ExampleServiceDispatcher {
    number_to_number: {
        payload: NumberToNumber;
        response: number;
    };
    string_to_string: {
        payload: string;
        response: UppercaseResponse;
    };
}

describe('@deltic/service-dispatcher', () => {
    let lastType: any = undefined;
    let callOrder: string[];
    const exampleServiceDispatcher = new ServiceDispatcher<ExampleServiceDispatcher>(
        {
            number_to_number: async (input: NumberToNumber): Promise<number> => input.value,
            string_to_string: async (input: string): Promise<UppercaseResponse> => ({
                value: input.toUpperCase(),
            }),
        },
        [
            (input, next) => {
                lastType = input.type;
                callOrder.push('first');

                return next(input);
            },
            async (input, next) => {
                const response = await next(input);

                callOrder.push('last');

                return response;
            },
            (input, next) => {
                lastType = input.type;
                callOrder.push('second');

                return next(input);
            },
        ],
    );

    beforeEach(() => {
        lastType = undefined;
        callOrder = [];
    });

    test('a bus forwards to the correct handler', async () => {
        const n = await exampleServiceDispatcher.handle({type: 'number_to_number', payload: {value: 10}});
        expect(lastType).toBe('number_to_number');
        expect(n).toEqual(10);
        const s = await exampleServiceDispatcher.handle({type: 'string_to_string', payload: 'frank'});
        expect(s).toEqual({value: 'FRANK'});
        expect(lastType).toBe('string_to_string');
    });

    test('middleware is invoked during handling', async () => {
        await exampleServiceDispatcher.handle({type: 'number_to_number', payload: {value: 10}});
        expect(lastType).toBe('number_to_number');
        await exampleServiceDispatcher.handle({type: 'string_to_string', payload: 'frank'});
        expect(lastType).toBe('string_to_string');
    });

    test('middleware is invoked in order of declaratin', async () => {
        await exampleServiceDispatcher.handle({type: 'number_to_number', payload: {value: 10}});

        expect(callOrder).toEqual(['first', 'second', 'last']);
    });

    test('a bus throws when input is not supported', async () => {
        await expect(exampleServiceDispatcher.handle({type: 'unknown', payload: true} as any)).rejects.toThrow();
    });
});
