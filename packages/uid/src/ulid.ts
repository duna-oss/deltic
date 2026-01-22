import {type IdConversion, type IdValidator, PrefixedBrandedIdGenerator} from '@deltic/uid';
import {ulid, isValid, type ULID, type UUID, ulidToUUID, uuidToULID} from 'ulid';

export function ulidPrefixedBrandedIdGenerator<Prefix extends string>(prefix: Prefix): PrefixedBrandedIdGenerator<Prefix> {
    return new PrefixedBrandedIdGenerator(
        prefix,
        ulid,
    );
}

export class UlidToUuidIdConversion implements IdConversion<ULID, UUID> {
    fromDatabase(to: UUID): ULID {
        return uuidToULID(to);
    }

    toDatabase(from: ULID): UUID {
        return ulidToUUID(from);
    }
}

export const isValidUlid: IdValidator<ULID> = isValid as IdValidator<ULID>;
