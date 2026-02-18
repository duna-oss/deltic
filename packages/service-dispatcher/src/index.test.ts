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
            (type, payload, next) => {
                lastType = type;
                callOrder.push('first');

                return next(type, payload);
            },
            async (type, payload, next) => {
                const response = await next(type, payload);

                callOrder.push('last');

                return response;
            },
            (type, payload, next) => {
                lastType = type;
                callOrder.push('second');

                return next(type, payload);
            },
        ],
    );

    beforeEach(() => {
        lastType = undefined;
        callOrder = [];
    });

    test('a bus forwards to the correct handler', async () => {
        const n = await exampleServiceDispatcher.handle('number_to_number', {value: 10});
        expect(lastType).toBe('number_to_number');
        expect(n).toEqual(10);
        const s = await exampleServiceDispatcher.handle('string_to_string', 'frank');
        expect(s).toEqual({value: 'FRANK'});
        expect(lastType).toBe('string_to_string');
    });

    test('middleware is invoked during handling', async () => {
        await exampleServiceDispatcher.handle('number_to_number', {value: 10});
        expect(lastType).toBe('number_to_number');
        await exampleServiceDispatcher.handle('string_to_string', 'frank');
        expect(lastType).toBe('string_to_string');
    });

    test('middleware is invoked in order of declaratin', async () => {
        await exampleServiceDispatcher.handle('number_to_number', {value: 10});

        expect(callOrder).toEqual(['first', 'second', 'last']);
    });

    test('a bus throws when input is not supported', async () => {
        await expect(exampleServiceDispatcher.handle('unknown' as any, true as any)).rejects.toThrow();
    });
});
