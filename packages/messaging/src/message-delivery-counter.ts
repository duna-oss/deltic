export interface MessageDeliveryCounter<Key> {
    increment(key: Key): Promise<number>;
}

export class MessageDeliveryCounterUsingMemory<Key> implements MessageDeliveryCounter<Key> {
    private readonly counts: Map<Key, number> = new Map();

    async increment(key: Key): Promise<number> {
        const count = (this.counts.get(key) ?? 0) + 1;
        this.counts.set(key, count);

        return count;
    }
}
