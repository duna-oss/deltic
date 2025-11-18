## Key/Value Store

This module provides a general purpose key value store.

### Setup

Before using, each type of storage should have their own
database table. For this, you need to create a migration:

```typescript
import {type Knex} from 'knex';
import {createKeyValueSchema, dropKeyValueSchema} from '../tools/key-value-store/knex.js';


export async function up(knex: Knex): Promise<void> {
    await createKeyValueSchema(knex, 'my_table_name');
}


export async function down(knex: Knex): Promise<void> {
    await dropKeyValueSchema(knex, 'my_table_name');
}


```

### Usage


There are three operations; `persist`, `retrieve`, and
`remove`. Since storage typically happens over the network,
all operations are asynchronous.

```typescript
import {KeyValueStoreUsingKnex} from './knex.js';

const storage = new KeyValueStoreUsingKnex<KeyType, ValueType>(
    'my_table_name',
    connectionProvider, // from '@tools/knex-async-transactions
);

// store
await storage.persist(key, value);


// retreive
const storedValue = await storage.retrieve(key);

// delete
await storage.remove(key);
```

### Testing

For testing, an in-memory implementation is provided:

```typescript
import {KeyValueStoreUsingMemory} from './exports.js';

const storage = new KeyValueStoreUsingMemory<KeyType, ValueType>();
```
