// Auto-generated from contracts/PRIMITIVES.md
// Do not edit manually

/**
 * Represents a person, system, or AI that can participate in conversations, decisions, and work.
 */
export interface Actor {
  id: string;
  name: string;
  display_name: string;
  type: 'HUMAN' | 'SYSTEM' | 'AI';
  community_id?: string;
  external_identities: Array<{ external_source: string; identity: unknown }>;
  avatar_url?: string;
  created_at: Date | number;
  updated_at: Date | number;
}

/**
 * Represents a conversation initiated by a human Actor
 */
export interface Conversation {
  id: string;
  actor_ids: string[];
  title: string;
  external_id?: string;
  external_source?: string;
  status?: string;
  organization?: string;
  created_at: Date | number;
  updated_at: Date | number;
}

/**
 * An important point in the lifecycle of a conversation. A new checkpoint is created each time the LLM processes the conversation, with the summary field containing a versioned summary of the conversation state.
 */
export interface ConversationCheckpoint {
  id: string;
  conversation_id: string;
  checkpoint_type: 'CONVERSATION_STARTED' | 'BEGIN_WORK' | 'NEED_INFORMATION' | 'CLOSE_CONVERSATION' | 'WORK_COMPLETED';
  summary: string;
  created_at: Date | number;
}

/**
 * A commitment to perform work authorized by a ConversationCheckpoint
 */
export interface Tasks {
  id: string;
  conversation_id: string;
  checkpoint_id: string;
  instructions: string;
  assigned_to?: string;
  created_at: Date | number;
  generated_artifacts?: unknown;
}

/**
 * An immutable record of task progress or completion.
 */
export interface TaskCheckpoint {
  id: string;
  task_id: string;
  type: 'WORK_STARTED' | 'WORK_PAUSED' | 'WORK_COMPLETED' | 'WORK_REJECTED' | 'WORK_APPROVED';
  created_at: Date | number;
}

/**
 * A contextual contribution from an Actor within a Conversation.
 */
export interface Message {
  id: string;
  time: Date | number;
  actor_id: string;
  conversation_id: string;
  task_id?: string;
  content: string;
  external_identity?: string;
}

