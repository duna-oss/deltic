import {type DefineVersionedStream, type UpcastersForVersionedStream} from './upcasting.js';
import type {AnyMessageFrom, Message} from './index.js';

// =============================================================================
// Test Stream Definitions
// =============================================================================

/**
 * V1 schema for user_created event - original schema
 */
export interface UserCreatedV1 {
    readonly username: string;
}

/**
 * V2 schema for user_created event - added email field
 */
export interface UserCreatedV2 {
    readonly username: string;
    readonly email: string;
}

/**
 * V3 schema for user_created event - added age field (current version)
 */
export interface UserCreatedV3 {
    readonly username: string;
    readonly email: string;
    readonly age: number;
}

/**
 * Versioned stream definition with both versioned and non-versioned messages.
 * - user_created: has 3 versions (V1 -> V2 -> V3)
 * - user_deleted: no versioning (single schema)
 */
export type TestVersionedStream = DefineVersionedStream<{
    aggregateRootId: string;
    messages: {
        user_created: [UserCreatedV1, UserCreatedV2, UserCreatedV3];
        user_deleted: {userId: string};
    };
}>;

/**
 * Upcasters for the test stream.
 * - user_created needs 2 upcasters to go from V1 -> V2 -> V3
 */
export const testUpcasters: UpcastersForVersionedStream<TestVersionedStream> = {
    user_created: [
        // V1 -> V2: add default email
        (message: Message<'user_created', UserCreatedV1, string>) => ({
            ...message,
            payload: {
                ...message.payload,
                email: `${message.payload.username}@example.com`,
            },
        }),
        // V2 -> V3: add default age
        (message: Message<'user_created', UserCreatedV2, string>) => ({
            ...message,
            payload: {
                ...message.payload,
                age: 0,
            },
        }),
    ],
};

// =============================================================================
// Helper Functions
// =============================================================================

export function makeUserCreatedV1(username: string, schemaVersion?: number): AnyMessageFrom<TestVersionedStream> {
    // Legacy V1 message - only username field, but stored with V3 shape after being upcasted
    // We set schema_version=0 so upcasters know to transform it
    return {
        type: 'user_created',
        payload: {
            username,
            email: `${username}@example.com`, // Would be added by V1->V2 upcaster
            age: 0, // Would be added by V2->V3 upcaster
        },
        headers: {schema_version: schemaVersion ?? 0},
    };
}

export function makeUserCreatedV2(username: string, email: string, schemaVersion?: number): AnyMessageFrom<TestVersionedStream> {
    // Legacy V2 message - username + email fields, but missing age
    return {
        type: 'user_created',
        payload: {
            username,
            email,
            age: 0, // Would be added by V2->V3 upcaster
        },
        headers: {schema_version: schemaVersion ?? 1},
    };
}

export function makeUserCreatedV3(username: string, email: string, age: number, schemaVersion?: number): AnyMessageFrom<TestVersionedStream> {
    return {
        type: 'user_created',
        payload: {username, email, age},
        headers: {schema_version: schemaVersion ?? 2},
    };
}

export function makeUserDeleted(userId: string): AnyMessageFrom<TestVersionedStream> {
    return {
        type: 'user_deleted',
        payload: {userId},
        headers: {},
    };
}
