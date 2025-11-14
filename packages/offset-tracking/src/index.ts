export type OffsetType = number | string;
export type IdType = number | string;

export interface OffsetRepository<Offset extends OffsetType = number, Id extends IdType = string> {
    retrieve(identifier: Id): Promise<Offset | undefined>,
    store(identifier: Id, offsets: Offset): Promise<void>,
}

export class OffsetRepositoryUsingMemory<
    Offset extends OffsetType = number,
    Id extends IdType = string,
> implements OffsetRepository<Offset, Id> {
    private readonly offsets = new Map<Id, Offset>();

    async retrieve(identifier: Id): Promise<Offset | undefined> {
        return this.offsets.get(identifier);
    }

    async store(identifier: Id, offsets: Offset): Promise<void> {
        this.offsets.set(identifier, offsets);
    }

    allOffsets() {
        return this.offsets;
    }
}