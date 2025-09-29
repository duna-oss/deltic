import {resolveOptions, maybeAbort, AbortSignalOptions} from './index.js';
import {setTimeout} from 'node:timers/promises';

describe('AbortSignalOptions', () => {
    test('timeouts are turned into AbortSignals', async () => {
        const options = resolveOptions<AbortSignalOptions>({
            timeout: 0,
        });
        await setTimeout(1);

        expect(options.abortSignal).toBeInstanceOf(AbortSignal);
        expect(options.abortSignal?.aborted).toEqual(true);
    });

    test('when using timeouts, other AbortSignals cascade into the resolved AbortSignals', () => {
        const controller = new AbortController();
        const options = resolveOptions<AbortSignalOptions>({
            timeout: 100,
            abortSignal: controller.signal,
        });

        controller.abort('this is why');

        expect(options.abortSignal?.aborted).toEqual(true);
        expect(options.abortSignal?.reason).toEqual('this is why');
    });

    test('when using timeouts, the timeout works even when an abort-signal is provided', async () => {
        const controller = new AbortController();
        const options = resolveOptions<AbortSignalOptions>({
            timeout: 0,
            abortSignal: controller.signal,
        });
        await setTimeout(1);

        expect(options.abortSignal?.aborted).toEqual(true);
    });

    test('when aborted, maybeAbort throws the reason', async () => {
        const controller = new AbortController();
        const signal = controller.signal;
        expect(() => maybeAbort(signal)).not.toThrow();

        controller.abort('this is why');
        expect(() => maybeAbort(signal)).toThrow('this is why');
    });
});
