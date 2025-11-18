import type {OffsetIdType, OffsetRepository, OffsetType} from './index.js';

export class OffsetRepositoryUsingMemory<
    Offset extends OffsetType = number,
    Id extends OffsetIdType = string,
> implements OffsetRepository<Offset, Id> {
    private readonly offsets = new Map<Id, Offset>();

    async retrieve(identifier: Id): Promise<Offset | undefined> {
        return this.offsets.get(identifier);
    }

    async store(identifier: Id, offsets: Offset): Promise<void> {
        this.offsets.set(identifier, offsets);
    }
}