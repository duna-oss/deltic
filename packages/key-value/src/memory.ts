import objectHash from 'object-hash';
import type {KeyType, KeyValueStore, ValueType} from '@deltic/key-value';

export class KeyValueStoreUsingMemory<Key extends KeyType, Value extends ValueType> implements KeyValueStore<
    Key,
    Value
> {
    private storage: Map<string, Value> = new Map();

    async persist(key: Key, value: Value): Promise<void> {
        this.storage.set(this.resolveKey(key), value);
    }

    async retrieve(key: Key): Promise<Value | undefined> {
        return this.storage.get(this.resolveKey(key));
    }

    async remove(key: Key): Promise<void> {
        this.storage.delete(this.resolveKey(key));
    }

    resolveKey(key: KeyType): string {
        return typeof key === 'object' ? objectHash(key, {algorithm: 'sha3-512'}) : String(key);
    }

    async clear(): Promise<void> {
        this.storage.clear();
    }
}
