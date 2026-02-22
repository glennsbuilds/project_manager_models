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

**Future Work:**
- Community
- Tasks
- TaskCheckpoint

## Primitives

### Actor

Represents a person, system, or AI that can participate in conversations, decisions, and work.

#### Fields

* id: GUID
* name: string
* display_name: string
* type: ENUM(HUMAN | SYSTEM | AI)
* community_id?: GUID
* external_identities: [{ "external_source": string, "identity"}]
* avatar_url?: string
* created_at: timestamp
* updated_at: timestamp

### Conversation
Represents a conversation initiated by a human Actor

#### Fields
- id: GUID
- actor_ids: [GUID]
- title: string
- external_id?: string
- external_source?: string
- status?: string
- organization?: string
- created_at: timestamp
- updated_at: timestamp

### ConversationCheckpoint
An important point in the lifecycle of a conversation. A new checkpoint is created each time the LLM processes the conversation, with the summary field containing a versioned summary of the conversation state.

#### Fields
- id: GUID
- conversation_id: GUID
- checkpoint_type: Enum with the following possible values:
  - CONVERSATION_STARTED
  - BEGIN_WORK
  - NEED_INFORMATION
  - CLOSE_CONVERSATION
  - WORK_COMPLETED
- summary: string (LLM-optimized representation of conversation state including goals, decisions, open questions, and current status)
- created_at: timestamp


### Community 

Represents a group of Actors who participate in in conversations and tasks 

#### Fields 

* id: GUID  
* name: string   
* description?:string

### Tasks

A commitment to perform work authorized by a ConversationCheckpoint

#### Fields 

* id: GUID
* conversation_id: GUID
* checkpoint_id: GUID
* instructions: string
* assigned_to?: GUID
* created_at: timestamp

### TaskCheckpoint

An immutable record of task progress or completion.

#### Fields

* id: GUID  
* task_id: GUID  
* type: ENUM (WORK_STARTED | WORK_PAUSED | WORK_COMPLETED | WORK_REJECTED|WORK_APPROVED)  
* created_at: timestamp

### Message

A contextual contribution from an Actor within a Conversation.

#### Fields:

* id: GUID
* time: timestamp
* actor_id: GUID
* conversation_id: GUID
* task_id?: GUID
* content: string
* external_identity?: string

### Interfaces 

We will also need to create interfaces for services that receive and persist the primitives to be written to:

ConversationStore  
MessageStore  
CheckpointStore  
TaskStore  
CommunityStore
ActorStore
