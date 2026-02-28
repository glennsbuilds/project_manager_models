# Primitives

## IMPORTANT

* Primitives in this document represent the core data model of this project
* In the event that you are requested to build a service that needs a primitive that doesn't exist in this document you should reject the request and prompt the user to either redesign the service or create a new primitive in this document
* Similarly, if you are requested to build a service that uses nonexistent fields or uses fields that are typed differently than described in this document you should also reject the request and prompt the user for changes

## Implementation Status

**Currently Implementing:**
- Actor
- Conversation
- ConversationCheckpoint
- Message
- Community
- Task
- TaskCheckpoint
- InstalledApplication

**Future Work:**
- *(none)*

## Primitives

### Actor

Represents a person, system, or AI that can participate in conversations, decisions, and work.

#### Fields

* id: GUID
* name: string
* display_name: string
* type: ENUM(HUMAN | SYSTEM | AI)
* community_id?: GUID
* external_identities: [{ "external_source": string, "identity": string }]
* avatar_url?: string
* created_at: timestamp
* updated_at: timestamp

### Conversation

Represents a conversation initiated by a human Actor.

#### Fields

* id: GUID
* actor_ids: [GUID]
* title: string
* external_id?: string
* external_source?: string
* status?: string
* organization?: string
* created_at: timestamp
* updated_at: timestamp

### ConversationCheckpoint

An important point in the lifecycle of a conversation. A new checkpoint is created each time the LLM processes the conversation, with the summary field containing a versioned summary of the conversation state.

#### Fields

* id: GUID
* conversation_id: GUID
* checkpoint_type: ENUM(CONVERSATION_STARTED | BEGIN_WORK | NEED_INFORMATION | CLOSE_CONVERSATION | WORK_COMPLETED)
* summary: string — LLM-optimized representation of conversation state including goals, decisions, open questions, and current status
* created_at: timestamp

### Community

Represents a group of Actors who participate in conversations and tasks.

#### Fields

* id: GUID
* name: string
* description?: string
* created_at: timestamp
* updated_at: timestamp

### Task

A commitment to perform work authorized by a ConversationCheckpoint.

#### Fields

* id: GUID
* conversation_id: GUID
* checkpoint_id: GUID
* instructions: string
* assigned_to?: GUID — Actor id of the assignee (human or AI)
* status: ENUM(PENDING | IN_PROGRESS | COMPLETED | REJECTED)
* created_at: timestamp
* updated_at: timestamp
* generated_artifacts?: { response_text: string, format?: 'markdown' | 'text' }

### TaskCheckpoint

An immutable record of task progress or completion.

#### Fields

* id: GUID
* task_id: GUID
* type: ENUM(WORK_STARTED | WORK_PAUSED | WORK_COMPLETED | WORK_REJECTED | WORK_APPROVED)
* notes?: string — optional human or agent commentary on this checkpoint
* created_at: timestamp

### Message

A contextual contribution from an Actor within a Conversation.

#### Fields

* id: GUID
* actor_id: GUID
* conversation_id: GUID
* task_id?: GUID
* content: string
* external_identity?: string
* created_at: timestamp

### InstalledApplication

Records that a specific application version is installed in a community. Owned exclusively by the platform layer — no application may write this primitive directly.

See `contracts/platform/APPLICATION_MODEL.md` for the application manifest definition and `contracts/platform/COMMUNITY_CONFIGURATION.md` for deployment and rollout details.

#### Fields

* id: GUID
* community_id: GUID
* application_name: string — matches `name` in the application manifest
* installed_version: string — semantic version currently serving 100% of traffic
* target_version?: string — version being rolled out (absent when no rollout in progress)
* rollout_percentage: integer (0–100) — percentage of traffic on target_version
* status: ENUM(INSTALLING | ACTIVE | UPDATING | DISABLED)
* installed_at: timestamp
* updated_at: timestamp

## Stores

Interfaces for services that receive and persist primitives:

* ActorStore
* ConversationStore
* MessageStore
* CheckpointStore
* TaskStore
* TaskCheckpointStore
* CommunityStore
* InstalledApplicationStore
