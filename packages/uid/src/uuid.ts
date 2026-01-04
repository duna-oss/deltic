import {PrefixedBrandedIdGenerator} from './index.js';
import * as uuid from 'uuid';

export function uuidV7PrefixedBrandedIdGenerator<Prefix extends string>(prefix: Prefix): PrefixedBrandedIdGenerator<Prefix> {
    return new PrefixedBrandedIdGenerator(
        prefix,
        uuid.v7,
    );
}