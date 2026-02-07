// Main function
export {setupEventSourcing} from './event-sourcing.js';

// Types
export type {
    EventSourcingConfig,
    EventSourcingConfigBase,
    EventSourcingServiceKeys,
    EventSourcingServices,
    SnapshotConfig,
} from './event-sourcing.js';

// Infrastructure
export type {
    InfrastructureProvider,
    MessageRepositoryOptions,
    OutboxRepositoryOptions,
    SnapshotRepositoryOptions,
} from './infrastructure-provider.js';
