import type {
    AggregateIdWithStreamOffset,
    AnyMessageFrom,
    MessageRepository,
    MessagesFrom,
    StreamDefinition,
} from './index.js';
import {SyncTenantContext, type TenantContextReader} from '@deltic/context';

import {messageWithHeaders} from './helpers.js';

export class MessageRepositoryUsingMemory<Stream extends StreamDefinition> implements MessageRepository<Stream> {
    private messages: Map<string | number | undefined, Map<Stream['aggregateRootId'], MessagesFrom<Stream>>> = new Map();
    private _lastCommit: MessagesFrom<Stream> = [];
    private incrementalId: number = 0;

    constructor(
        private readonly tenantContext: TenantContextReader<Stream['aggregateRootId']> = new SyncTenantContext()
    ) {
    }

    async persist(id: Stream['aggregateRootId'], messages: MessagesFrom<Stream>): Promise<void> {
        this.persistSync(id, messages);
    }

    persistSync(id: Stream['aggregateRootId'], messages: MessagesFrom<Stream>): void {
        const tenantId = this.tenantContext.resolve();
        messages = messages.map(m => messageWithHeaders(m, {
            aggregate_root_id: id,
            tenant_id: tenantId,
            stream_offset: ++this.incrementalId,
            stream_partition: m.headers['stream_partition'] ?? 0,
        }));
        const list = (this.messages.get(tenantId)?.get(id) || []).concat(messages);
        this._lastCommit = messages;

        if (!this.messages.has(tenantId)) {
            this.messages.set(tenantId, new Map());
        }

        this.messages.get(tenantId)!.set(id, list);
    }

    async* retrieveAllAfterVersion(id: Stream['aggregateRootId'], version: number): AsyncGenerator<AnyMessageFrom<Stream>, any, unknown> {
        for await (const m of this.retrieveAllForAggregate(id)) {
            if (Number(m.headers['aggregate_root_version']) > version) {
                yield m;
            }
        }
    }

    retrieveAllUntilVersion(id: Stream['aggregateRootId'], version: number): AsyncGenerator<AnyMessageFrom<Stream>, any, unknown> {
        return this.retrieveBetweenVersions(id, 0, version);
    }

    async* retrieveBetweenVersions(id: Stream['aggregateRootId'], after: number, before: number): AsyncGenerator<AnyMessageFrom<Stream>, any, unknown> {
        for await (const m of this.retrieveAllForAggregate(id)) {
            const version = Number(m.headers['aggregate_root_version']);

            if (version > after && version < before) {
                yield m;
            }
        }
    }

    async* retrieveAllForAggregate(id: Stream['aggregateRootId']): AsyncGenerator<AnyMessageFrom<Stream>> {
        const tenantId = this.tenantContext.resolve();

        for (const m of (this.messages.get(tenantId)?.get(id) || [])) {
            yield m;
        }
    }

    async* paginateIds(limit: number, afterId?: Stream['aggregateRootId'], partition: number = 0): AsyncGenerator<AggregateIdWithStreamOffset<Stream>> {
        let left = limit;
        let shouldYield = afterId === undefined;
        const collected = new Set<Stream['aggregateRootId']>();

        for (const group of this.messages.values()) {
            for (const [aggregateId, messages] of group) {
                if (
                    collected.has(aggregateId) ||
                    messages.length === 0 ||
                    messages.some(message => partition !== Number(message.headers['stream_partition'] ?? 0))
                ) {
                    continue;
                }
                collected.add(aggregateId);

                if (!shouldYield) {
                    if (aggregateId === afterId) {
                        shouldYield = true;
                    }

                    continue;
                }

                const versions = messages.map(message => Number(message.headers['aggregate_root_version'] ?? 0));

                yield {id: aggregateId, version: Math.max(...versions)};
                left--;

                if (left === 0) {
                    return;
                }
            }
        }
    }

    clear(): void {
        this.messages.clear();
        this._lastCommit = [];
    }

    get lastCommit(): MessagesFrom<Stream> {
        return this._lastCommit;
    }

    clearLastCommit(): void {
        this._lastCommit = [];
    }
}
