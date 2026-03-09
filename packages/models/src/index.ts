/**
 * @glennsbuilds/pm-models
 *
 * Generated TypeScript types, schemas, and utilities for project manager domain models.
 * Auto-generated from contracts/ - do not edit manually.
 *
 * Exports:
 * - Types: All domain model interfaces (Actor, Conversation, Message, etc.)
 * - Schemas: Zod validators for runtime validation
 * - CloudEvents: CloudEvents v1.0 spec support and helpers
 *
 * @example
 * ```typescript
 * import { Conversation, ConversationSchema } from '@glennsbuilds/pm-models';
 * import { CloudEvent, createCloudEvent } from '@glennsbuilds/pm-models';
 *
 * // Use types
 * const convo: Conversation = { ... };
 *
 * // Validate at runtime
 * const validated = ConversationSchema.parse(data);
 *
 * // Create CloudEvents
 * const event = createCloudEvent('project_manager.conversation.started', 'my-service', data);
 * ```
 */

// Re-export generated schemas (includes types via Zod infer)
export * from './schemas';

// Re-export CloudEvents utilities
export * from './cloudEvents';
