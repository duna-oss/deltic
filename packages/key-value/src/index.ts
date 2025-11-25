export type KeyType = null | object | undefined | string | number | boolean | KeyType[] | KeyObject;

export type KeyObject = {
    [index: string | number]: KeyType;
};

export interface KeyConversion<Key extends KeyType, DatabaseKey extends string | number> {
    (key: Key): DatabaseKey;
}

export type ValueType = KeyType

export interface KeyValueStore<Key extends KeyType, Value extends ValueType> {
    persist(key: Key, value: Value): Promise<void>;
    retrieve(key: Key): Promise<Value | undefined>;
    remove(key: Key): Promise<void>;
    clear(): Promise<void>;
}
