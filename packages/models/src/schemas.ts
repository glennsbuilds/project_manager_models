// Auto-generated from contracts/domain/PRIMITIVES.md
// Do not edit manually

import { z } from "zod";

/**
 * Represents a person, system, or AI that can participate in conversations, decisions, and work.
 */
export const ActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name: z.string(),
  type: z.enum(['HUMAN', 'SYSTEM', 'AI']),
  community_id: z.string().uuid().optional(),
  external_identities: z.array(z.object({ external_source: z.string(), identity: z.unknown() })),
  avatar_url: z.string().optional(),
  created_at: z.union([z.date(), z.number()]),
  updated_at: z.union([z.date(), z.number()]),
}).strict();

export type Actor = z.infer<typeof ActorSchema>;

/**
 * Represents a conversation initiated by a human Actor
 */
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  actor_ids: z.array(z.string().uuid()),
  title: z.string(),
  external_id: z.string().optional(),
  external_source: z.string().optional(),
  status: z.string().optional(),
  organization: z.string().optional(),
  created_at: z.union([z.date(), z.number()]),
  updated_at: z.union([z.date(), z.number()]),
}).strict();

export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * An important point in the lifecycle of a conversation. A new checkpoint is created each time the LLM processes the conversation, with the summary field containing a versioned summary of the conversation state.
 */
export const ConversationCheckpointSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  checkpoint_type: z.enum(['CONVERSATION_STARTED', 'BEGIN_WORK', 'NEED_INFORMATION', 'CLOSE_CONVERSATION', 'WORK_COMPLETED']),
  summary: z.string(),
  created_at: z.union([z.date(), z.number()]),
}).strict();

export type ConversationCheckpoint = z.infer<typeof ConversationCheckpointSchema>;

/**
 * A commitment to perform work authorized by a ConversationCheckpoint
 */
export const TasksSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  checkpoint_id: z.string().uuid(),
  instructions: z.string(),
  assigned_to: z.string().uuid().optional(),
  created_at: z.union([z.date(), z.number()]),
  generated_artifacts: z.unknown().optional(),
}).strict();

export type Tasks = z.infer<typeof TasksSchema>;

/**
 * An immutable record of task progress or completion.
 */
export const TaskCheckpointSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  type: z.enum(['WORK_STARTED', 'WORK_PAUSED', 'WORK_COMPLETED', 'WORK_REJECTED', 'WORK_APPROVED']),
  created_at: z.union([z.date(), z.number()]),
}).strict();

export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;

/**
 * A contextual contribution from an Actor within a Conversation.
 */
export const MessageSchema = z.object({
  id: z.string().uuid(),
  time: z.union([z.date(), z.number()]),
  actor_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  content: z.string(),
  external_identity: z.string().optional(),
}).strict();

export type Message = z.infer<typeof MessageSchema>;

