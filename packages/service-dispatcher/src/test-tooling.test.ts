import {type AnyStagedResponse, errorForMissingMockedResponseForInput, MockedService} from './test-tooling.js';
import type {AnyInputForService} from './index.js';

interface MockedServiceDefinition {
    ping: {
        payload: 'ping' | 'lol';
        response: 'pong' | 'nope';
    };
    other: {
        payload: 'other';
        response: 'other';
    };
}

describe('mocked service bus', () => {
    test('it can mock responses', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({
            type: 'ping',
            payload: 'ping',
            response: 'pong',
        });

        const response = await service.handle('ping', 'ping');

        expect(response).toEqual('pong');
    });

    test('it can mock an error', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        const error = new Error('uh oh');
        service.stageResponse({
            type: 'ping',
            payload: 'ping',
            error,
        });

        await expect(service.handle('ping', 'ping')).rejects.toThrow(error);
    });

    test('it can mock responses by only matching the command', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({
            type: 'ping',
            response: 'pong',
        });

        const response = await service.handle('ping', 'ping');

        expect(response).toEqual('pong');
    });

    test('it only responds once', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({
            type: 'ping',
            response: 'pong',
        });

        await service.handle('ping', 'ping');

        await expect(service.handle('ping', 'ping')).rejects.toThrow(
            errorForMissingMockedResponseForInput({
                type: 'ping',
                payload: 'ping',
            }),
        );
    });

    test('it can respond multiple times with the same response configuration', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({
            type: 'ping',
            response: 'pong',
        });
        service.stageResponse({
            type: 'ping',
            response: 'pong',
        });

        await service.handle('ping', 'ping');

        const response = await service.handle('ping', 'ping');

        expect(response).toEqual('pong');
    });

    test('knows if it was called or not', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({type: 'ping', response: 'pong'});

        expect(service.wasCalled()).toEqual(false);

        await service.handle('ping', 'ping');

        expect(service.wasCalled()).toEqual(true);
    });

    test('staged responses are removed when reset', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({type: 'ping', response: 'pong'});

        service.reset();

        await expect(service.handle('ping', 'ping')).rejects.toThrow(
            errorForMissingMockedResponseForInput({
                type: 'ping',
                payload: 'ping',
            }),
        );
    });

    test('calls are removed when reset', async () => {
        const service = new MockedService<MockedServiceDefinition>();
        service.stageResponse({type: 'ping', response: 'pong'});
        await service.handle('ping', 'ping');

        expect(service.wasCalled()).toEqual(true);

        service.reset();

        expect(service.wasCalled()).toEqual(false);
    });

    test.each([
        [{type: 'ping', payload: 'ping'}, 2, true],
        [{type: 'ping', payload: 'ping'}, 1, false],
        [{type: 'ping', payload: 'ping'}, 3, false],
        [{type: 'ping', payload: 'lol'}, 2, false],
        [{type: 'ping', payload: 'lol'}, 1, false],
        [{type: 'ping', payload: 'lol'}, 3, false],
        [{type: 'other', payload: 'other'}, 1, false],
        [{type: 'other', payload: 'other'}, 2, false],
        [{type: 'other', payload: 'other'}, 3, false],
    ] satisfies [AnyInputForService<MockedServiceDefinition>, number, boolean][])(
        'it can tell if it was or was not called with a command',
        async (inputCheck, times, expectToBeCalled) => {
            const service = new MockedService<MockedServiceDefinition>();
            service.stageResponse({
                type: 'ping',
                response: 'pong',
            });
            service.stageResponse({
                type: 'ping',
                response: 'pong',
            });

            await service.handle('ping', 'ping');

            await service.handle('ping', 'ping');

            expect(service.wasCalledWith(inputCheck, times)).toEqual(expectToBeCalled);
            expect(service.timesCalled()).toEqual(2);
            expect(service.wasCalled()).toEqual(true);
        },
    );

    test('it errors when no mock response is prepared for an input', async () => {
        const service = new MockedService<MockedServiceDefinition>();

        await expect(service.handle('ping', 'ping')).rejects.toThrow(
            errorForMissingMockedResponseForInput({
                type: 'ping',
                payload: 'ping',
            }),
        );
    });

    test.each([
        // everything different,
        {
            type: 'other',
            payload: 'other',
            response: 'other',
        },
        // only different command
        {
            type: 'other',
            response: 'other',
        },
        // same command, different payload
        {
            type: 'ping',
            payload: 'lol',
            response: 'pong',
        },
    ] satisfies AnyStagedResponse<MockedServiceDefinition>[])(
        'it errors when no mock response is prepared for a specific command',
        async stagedResponse => {
            const service = new MockedService<MockedServiceDefinition>();

            service.stageResponse(stagedResponse);

            await expect(service.handle('ping', 'ping')).rejects.toThrow(
                errorForMissingMockedResponseForInput({
                    type: 'ping',
                    payload: 'ping',
                }),
            );
        },
    );
});
