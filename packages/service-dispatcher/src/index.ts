export type ServiceStructure<D> = {
    [K in keyof D]: {payload: any, response: any}
};

export type AnyInputForService<Service extends ServiceStructure<Service>> = {
    [Type in keyof Service]: {
        readonly type: Type,
        readonly payload: Service[Type]['payload'],
    }
}[keyof Service];

export interface ServiceMiddleware<Service extends ServiceStructure<Service>> {
    <T extends keyof Service>(type: T, payload: Service[T]['payload'], next: NextFunction<Service>): Promise<Service[T]['response']>;
}

export interface NextFunction<Service extends ServiceStructure<Service>> {
    <T extends keyof Service>(type: T, payload: Service[T]['payload']): Promise<Service[T]['response']>;
}

export type ServiceHandlers<Service extends ServiceStructure<Service>> = {
    readonly [T in keyof Service]: (input: Service[T]['payload']) => Promise<Service[T]['response']>
};

export class InputNotSupported extends Error {
}

export interface Service<
    Structure extends ServiceStructure<Structure>,
> {
    handle<T extends keyof Structure>(type: T, payload: Structure[T]['payload']): Promise<Structure[T]['response']> | Structure[T]['response'],
}

interface ChainHandler<
    Service extends ServiceStructure<Service>,
> {
    <T extends keyof Service>(type: T, payload: Service[T]['payload']): Promise<Service[T]['response']> | Service[T]['response'],
}

export class ServiceDispatcher<Definition extends ServiceStructure<Definition>> implements Service<Definition> {
    private readonly chain: ChainHandler<Definition>;
    constructor(
        private readonly handlers: ServiceHandlers<Definition>,
        private readonly middlewares: ServiceMiddleware<Definition>[] = [],
    ) {
        let next: ChainHandler<Definition> = async (type, payload) => await this.process(type, payload);

        for (let index = this.middlewares.length - 1; index >= 0; index -= 1) {
            const m = this.middlewares[index];
            const n = next;
            next = async(type, input) => await m(type, input, n);
        }

        this.chain = next;
    }

    public handle<T extends keyof Definition>(type: T, payload: Definition[T]['payload']): Promise<Definition[T]['response']> {
        return (this.chain)(type, payload);
    }

    private async process<T extends keyof Definition>(type: T, payload: Definition[T]['payload']): Promise<Definition[T]['response']> {
        const handler = this.handlers[type];

        if (!handler) {
            throw new InputNotSupported(`Unable to handle input of type: ${type.toString()}`);
        }

        return await handler(payload);
    }
}
