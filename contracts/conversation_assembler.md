# Conversation Assembler Service Contract

## Overview
Source-agnostic service that prepares conversations for LLM processing. It receives `conversation_waiting` events from any event processor (GitHub, Slack, SMS, email, etc.), assembles the appropriate context — combining new content with the latest conversation checkpoint when applicable — and publishes a message for the LLM interface service.

This service is the bridge between intake and intelligence. It never talks to GitHub, Slack, or any external source directly. It only works with the normalized domain model (Conversations, Actors, content items) and conversation checkpoints stored in the database.

## Trigger

SQS queue subscribed to EventBridge events matching:
- Source: `project-manager.*` (any event processor)
- Detail type: `project_manager.conversation_waiting`

The Lambda is invoked by SQS with one or more records.

### Input Message

```json
{
  "version": "0",
  "id": "...",
  "detail-type": "project_manager.conversation_waiting",
  "source": "project-manager.github-event-processor",
  "detail": {
    "specversion": "1.0",
    "id": "...",
    "source": "project-manager.github-event-processor",
    "type": "project_manager.conversation_waiting",
    "time": "2026-02-10T21:40:00Z",
    "datacontenttype": "application/json",
    "traceparent": "00-698ba5223bc2a6b54fd0211630dc93b0-...-00",
    "tracestate": null,
    "data": {
      "conversation_id": "conv_abc123",
      "actor_id": "actor_def456",
      "is_new": false,
      "content": [
        {
          "author": "melodysdad",
          "body": "I think we should add retry logic to the webhook handler...",
          "timestamp": "2026-02-10T21:38:00Z",
          "type": "comment"
        }
      ]
    }
  }
}
```

### Key Fields

| Field | Location | Purpose |
|-------|----------|---------|
| `conversation_id` | `detail.data.conversation_id` | Look up Conversation and its checkpoint history |
| `actor_id` | `detail.data.actor_id` | Identify who triggered this round of the conversation |
| `is_new` | `detail.data.is_new` | Determines new vs. existing conversation assembly path |
| `content` | `detail.data.content` | Normalized content items from the source — already source-agnostic |
| `traceparent` | `detail.traceparent` | Distributed trace context — propagate downstream |

## Domain Concepts

### ConversationCheckpoint
A checkpoint represents an important point in the conversation lifecycle. Each time the LLM processes a conversation, it creates a new checkpoint with an updated summary of the conversation state.

- Checkpoints are **immutable** and stored chronologically in the database
- Each checkpoint's `summary` field contains an LLM-optimized representation of: the goal, decisions made, open questions, and current status
- Only the latest checkpoint is used for assembly — prior checkpoints are retained for audit/history
- The checkpoint `type` indicates the conversation state (CONVERSATION_STARTED, BEGIN_WORK, NEED_INFORMATION, CLOSE_CONVERSATION, WORK_COMPLETED)

For full field definitions, see the ConversationCheckpoint primitive in [PRIMITIVES.md](PRIMITIVES.md).

## Processing

### 1. Validate Incoming Event
- Parse the SQS record body as JSON
- Extract the CloudEvents `detail` envelope
- Validate required fields: `conversation_id`, `actor_id`, `is_new`, `content`
- IMPORTANT: If validation fails, log error with full context and let the message go to the DLQ

### 2. Branch: New vs. Existing Conversation

#### Path A: New Conversation (`is_new: true`)

1. Take the `content` array from the event (issue description + any initial comments)
2. Compose an LLM message containing:
   - The full initial content (description, existing comments)
   - The Actor who initiated the conversation
   - System instructions for the LLM's role (ask clarifying questions, help decompose the work, etc.)
3. Emit a `project_manager.llm_request` event with the composed message

#### Path B: Existing Conversation (`is_new: false`)

1. Fetch the **latest ConversationCheckpoint** from the database using `conversation_id`
2. Take the `content` array from the event (new comments since last sync)
3. Compose an LLM message containing:
   - The latest checkpoint's summary (so the LLM has full context without re-reading history)
   - The new content (comments that came in since the LLM last responded)
   - The Actor who sent the new content
   - Continuation instructions for the LLM (continue asking questions, check if ready to approve, etc.)
4. Emit a `project_manager.llm_request` event with the composed message

### 3. Emit LLM Request
- Publish a `project_manager.llm_request` event to EventBridge
- The LLM interface service (downstream) picks this up and handles the actual LLM interaction, response posting, and checkpoint creation

## LLM Message Composition

The assembled message should give the LLM everything it needs to continue the conversation effectively. The exact prompt structure is owned by this service.

### For New Conversations
```
You are a project decomposition assistant. A new conversation has been started.

## Initial Request
{content items — description and any comments}

## Submitted By
{actor display name / login}

## Your Task
- Understand what the user is trying to accomplish
- Ask clarifying questions to narrow down the scope
- Help decompose the work into actionable items
- When the design is clear enough, propose one or more prompts for a coding agent
```

### For Existing Conversations
```
You are a project decomposition assistant. Here is the current state of the conversation.

## Previous Checkpoint Summary
{summary from latest checkpoint}

## New Messages
{content items — new comments since last LLM turn}

## From
{actor display name / login}

## Your Task
- Review the new messages in context of the previous checkpoint summary
- Continue asking clarifying questions if needed
- If the design is converging, propose concrete next steps
- When ready, propose one or more prompts for a coding agent
```

<!-- OPEN: The prompt templates above are illustrative. The real prompts will need
  careful design. Should they live in the code, in the database, or in a
  separate prompt registry? -->

<!-- OPEN: Should the assembler distinguish between different *kinds* of conversations?
  e.g., a coding task vs. a vacation planning task vs. a hybrid task might need
  different system instructions. This could be driven by a field on the Conversation
  (e.g., conversation_type) or deferred to the LLM to figure out. -->

## Events Emitted

All events are published to EventBridge using CloudEvents format with source `project-manager.conversation-assembler`.

### project_manager.llm_request
- **When:** Always emitted after successful assembly
- **Purpose:** Signals to the LLM interface service that a conversation is ready for LLM processing
- **Data:**
  - `conversation_id` — which conversation this is for
  - `actor_id` — who triggered this round
  - `is_new` — whether this is the first LLM interaction for this conversation
  - `assembled_message` — the fully composed prompt for the LLM
  - `checkpoint_id` — ID of the checkpoint used for context (null for new conversations)
  - `trace_context` — propagated traceparent/tracestate

<!-- OPEN: Should there also be a project_manager.assembly_failed event for observability,
  or is logging + DLQ sufficient? -->

## Dependencies

### Infrastructure
- SQS queue (subscribed to EventBridge rule for `project_manager.conversation_waiting`)
- EventBridge (for publishing `llm_request` events)
- Database (for reading ConversationCheckpoints)
- Lambda execution role with permissions for SQS, EventBridge, and database read access

### Environment Variables
- `EVENT_BUS_NAME` — EventBridge bus name for publishing events
- Database connection configuration (table name, endpoint, etc.)

### External Services
- **None.** This service does not call any external APIs. It reads from the database and composes messages. This is intentional — all source-specific API calls happen in the event processors upstream.
- Structured logging library (Pino or equivalent)
- Schema validation library (Zod or equivalent)
- AWS SDK (EventBridge, database client)

## Error Handling

### Event validation fails
- Log: warning level, operation, validation failure details, raw event
- Behavior: Do not process further; let SQS retry / send to DLQ
- No events emitted

### Checkpoint not found (existing conversation, `is_new: false`)
- Log: error level, operation, conversation_id, "expected checkpoint but none found"
- Behavior: This is an unexpected state — a conversation that isn't new should have at least one checkpoint
- IMPORTANT: Do not process further; let the message go to DLQ for investigation
- This likely indicates a race condition or data integrity issue

### Database read fails
- Log: error level, operation, database error details
- Behavior: Do not process further; let SQS retry / send to DLQ

### EventBridge publish fails
- Log: error level, operation, publish failure details
- Behavior: Do not process further; let SQS retry / send to DLQ

### Unexpected error
- Log: error level, full error context, stack trace
- Behavior: Let SQS retry / send to DLQ

## Idempotency
- **Checkpoint reads** are idempotent: reading the latest checkpoint multiple times returns the same result (until the LLM creates a new checkpoint, which happens downstream)
- **Message composition** is deterministic: same inputs produce the same assembled message
- **Event emission** is NOT idempotent: retries may produce duplicate `llm_request` events — the LLM interface service must handle duplicates

## Notes
- This service is **source-agnostic** by design. It never knows or cares whether the content came from GitHub, Slack, SMS, or email. It works entirely with normalized content items and domain objects.
- The prompt templates are the core intellectual property of this service. They will evolve significantly as the product matures. Consider making them configurable rather than hardcoded.
- The `is_new` flag drives the branching logic, but the two paths share most of their structure. The main difference is whether a checkpoint is fetched and its summary included.
- Processing should be fast (Lambda timeout: 30s) — this service does no external API calls, only a database read and message composition.
- All decisions (new vs. existing path, checkpoint used, message size) must be logged per coding policy.
- Future enhancement: the assembler could enforce token/size limits on the composed message, truncating or summarizing content if it exceeds LLM context window limits.
