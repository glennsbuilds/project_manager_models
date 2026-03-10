# GitHub Event Processor Service Contract

## Overview
GitHub-specific intake service that consumes validated webhook events from the github-trigger service, resolves them into domain objects (Conversations and Actors), persists those objects, fetches relevant content from GitHub, and emits downstream events to coordinate further processing.

This is one of potentially many source-specific event processors. Each source (GitHub, Slack, SMS, email) will have its own processor that understands how to hydrate domain objects from that source's data. All processors emit the same `conversation_waiting` event, keeping everything downstream source-agnostic.

## Trigger

SQS queue subscribed to EventBridge events matching:
- Source: `project-manager.github-trigger`
- Detail type: `projects_v2_item.ready`

The Lambda is invoked by SQS with one or more records.

### Input Message

EventBridge envelope containing a CloudEvents-formatted message:

```json
{
  "version": "0",
  "id": "246e2dfc-afef-177d-f2ab-aa1a510bb729",
  "detail-type": "projects_v2_item.ready",
  "source": "project-manager.github-trigger",
  "account": "731001383937",
  "time": "2026-02-10T21:37:39Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "specversion": "1.0",
    "id": "a0e6dcaf-2733-4fab-9f3f-8c6474b062df",
    "source": "project-manager.github-trigger",
    "type": "projects_v2_item.ready",
    "time": "2026-02-10T21:37:38.839Z",
    "datacontenttype": "application/json",
    "traceparent": "00-698ba5223bc2a6b54fd0211630dc93b0-7fedf60619b59c0e-00",
    "tracestate": null,
    "data": {
      "item_id": 148096920,
      "item_node_id": "PVTI_lADODwOKGs4BMDMjzgjTx5g",
      "field_type": "single_select",
      "field_name": "Status",
      "to_value": "Ready",
      "from_value": "In review",
      "sender_login": "melodysdad",
      "organization_login": "glennsbuilds"
    }
  }
}
```

### Key Fields

| Field | Location | Purpose |
|-------|----------|---------|
| `item_node_id` | `detail.data.item_node_id` | Primary lookup key for Conversation resolution |
| `sender_login` | `detail.data.sender_login` | Primary lookup key for Actor resolution |
| `organization_login` | `detail.data.organization_login` | GitHub org context for API queries |
| `field_name` | `detail.data.field_name` | The project field that changed |
| `to_value` | `detail.data.to_value` | New value of the field |
| `from_value` | `detail.data.from_value` | Previous value of the field |
| `traceparent` | `detail.traceparent` | Distributed trace context — propagate to all downstream events |

## Domain Types

### Conversation
Represents a tracked work item. Currently backed by a GitHub Projects v2 item, but designed as a broader abstraction that can eventually encompass issues, discussions, or items from other sources.

For the complete Conversation schema, see [PRIMITIVES.md - Conversation](../domain/PRIMITIVES.md#conversation).

Key fields include:
- `id` — GUID
- `actor_ids` — [GUID]
- `title` — string
- `external_id` — string (optional, maps to `item_node_id` for GitHub Projects v2 items)
- `external_source` — string (optional, e.g. "github_projects_v2_item")
- `status` — string (optional)
- `organization` — string (optional)
- `created_at` — timestamp
- `updated_at` — timestamp

### Actor
Represents a user identity. Currently backed by a GitHub user, but designed as a broader abstraction that can eventually encompass identities from multiple communication sources (Slack, email, etc.).

For the complete Actor schema, see [PRIMITIVES.md - Actor](../domain/PRIMITIVES.md#actor).

Key fields include:
- `id` — GUID
- `name` — string
- `display_name` — string
- `type` — ENUM(HUMAN | SYSTEM | AI)
- `community_id` — GUID (optional)
- `external_identities` — [{ "external_source": string, "identity": string }] (maps `sender_login` to GitHub source)
- `avatar_url` — string (optional)
- `created_at` — timestamp
- `updated_at` — timestamp

## Processing

### 1. Validate Incoming Event
- Parse the SQS record body as JSON
- Extract the CloudEvents `detail` envelope
- Validate required fields exist in `detail.data`: `item_node_id`, `sender_login`, `organization_login`
- IMPORTANT: If validation fails, log error with full context and let the message go to the DLQ (do not silently discard)

### 2. Resolve Conversation
- Query the database for an existing Conversation where `external_id` matches `detail.data.item_node_id` and `external_source` equals "github_projects_v2_item"
- **If Conversation exists:** use it as-is for subsequent steps
- **If Conversation does not exist:**
  1. Query the GitHub GraphQL API for the Projects v2 item using `item_node_id` and `organization_login`
  2. Populate a new Conversation object with the returned data
  3. Persist the Conversation to the database
  4. Emit a `project_manager.conversation_started` event to EventBridge

When a new Conversation is created, all current field values are populated from the GitHub API query in step 2. Existing Conversations are used as-is; field updates (field_name, to_value, from_value) from this event are passed downstream to be processed by other services.

#### GraphQL Query: Fetch Projects v2 Item Details
```graphql
query {
  node(id: "<item_node_id>") {
    ... on ProjectV2Item {
      id
      content {
        ... on Issue {
          id
          title
          number
          repository {
            owner { login }
            name
          }
        }
        ... on PullRequest {
          id
          title
          number
          repository {
            owner { login }
            name
          }
        }
        ... on DraftIssue {
          id
          title
        }
      }
      project {
        title
      }
      fieldValues(first: 20) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field {
              ... on ProjectV2SingleSelectField {
                name
              }
            }
          }
          ... on ProjectV2ItemFieldTextValue {
            text
            field {
              ... on ProjectV2Field {
                name
              }
            }
          }
        }
      }
    }
  }
}
```

### 3. Resolve Actor
- Query the database for an existing Actor where `external_identities` array contains an entry with `external_source` = "github" and `identity` = `detail.data.sender_login`
- **If Actor exists:** use it as-is for subsequent steps
- **If Actor does not exist:**
  1. Query the GitHub API for user information using `sender_login`
  2. Populate a new Actor object with the returned data:
     - Set `name` to the GitHub user's login
     - Set `display_name` to the GitHub user's name (or login if name is null)
     - Set `type` to HUMAN
     - Set `external_identities` to `[{ "external_source": "github", "identity": "<sender_login>" }]`
     - Set `avatar_url` to the GitHub user's avatar URL
  3. Persist the Actor to the database
  4. Emit a `project_manager.actor_created` event to EventBridge

#### GraphQL Query: Fetch User Information
```graphql
query {
  user(login: "<sender_login>") {
    id
    login
    name
    avatarUrl
  }
}
```

### 4. Fetch Content from GitHub
This step is critical: the event processor is responsible for gathering all source-specific content so that downstream services remain source-agnostic.

- Query for the most recent **ConversationCheckpoint** for this Conversation
- **If no checkpoint exists** (new conversation or not yet processed):
  - Fetch the linked issue/item description (body) from GitHub
  - Fetch all existing comments on the issue (paginating through all pages if more than 100 comments exist)
  - Package as the initial conversation content

- **If checkpoint exists:**
  - Fetch only comments created **after** the checkpoint's `created_at` timestamp from GitHub (paginating through all pages if necessary)
  - Package as new content to append
  - The checkpoint contains a summary of the conversation up to that point, so only new comments need to be fetched

**Note:** ConversationCheckpoints are created when the LLM reaches key states:
- Needs more information from the user
- Begins work on a task
- Completes work on a task

#### GraphQL Query: Fetch Projects v2 Item and Comments
```graphql
query {
  node(id: "<item_node_id>") {
    ... on ProjectV2Item {
      id
      title
      body
      bodyHTML
      createdAt
      updatedAt
      content {
        ... on Issue {
          id
          title
          body
          bodyHTML
        }
        ... on PullRequest {
          id
          title
          body
          bodyHTML
        }
        ... on DraftIssue {
          id
          title
          body
          bodyHTML
        }
      }
      comments(first: 100, after: "<cursor>") {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          id
          body
          bodyHTML
          author {
            login
          }
          createdAt
        }
      }
    }
  }
}
```

**Pagination:** The query fetches up to 100 comments per request. If `hasNextPage` is true, use the `endCursor` from the previous response as the `after` parameter to fetch the next batch. Continue paginating until all comments after the checkpoint timestamp (or all comments for new conversations) have been retrieved.

### 5. Emit Conversation Waiting
- Once Conversation, Actor, and content are all resolved:
- Emit a `project_manager.conversation_waiting` event to EventBridge
- The event payload includes:
  - Conversation reference (id, external_source, external_id)
  - Actor reference (id)
  - `is_new` flag (true if Conversation was just created)
  - `content` — the source-specific content fetched in step 4, normalized into a source-agnostic format:
    - For new conversations: issue description + any existing comments
    - For existing conversations: only new comments since last checkpoint
  - Trace context (propagated `traceparent`)

## Events Emitted

All events are published to EventBridge using CloudEvents format with source `project-manager.github-event-processor`. For exact payload schemas, see [TRANSITIONS.md](../domain/TRANSITIONS.md).

### project_manager.conversation_started
- **When:** A new Conversation is created (first time this `item_node_id` is seen)
- **Purpose:** Signals that a new work item is being tracked
- **Schema:** See [TRANSITIONS.md - ConversationStarted](TRANSITIONS.md#transition-conversationstarted)

### project_manager.actor_created
- **When:** A new Actor is created (first time this `sender_login` is seen)
- **Purpose:** Signals that a new user identity has been registered
- **Schema:** See [TRANSITIONS.md](../domain/TRANSITIONS.md) for payload structure

### project_manager.conversation_waiting
- **When:** Always emitted after Conversation, Actor, and content are resolved
- **Purpose:** Signals to the conversation assembler that a conversation needs attention
- **Schema:** See [TRANSITIONS.md](../domain/TRANSITIONS.md)
- **Key Fields:**
  - `conversation_id` — internal Conversation ID
  - `actor_id` — internal Actor ID
  - `is_new` — boolean, true if Conversation was just created
  - `content` — normalized content array (source-agnostic format):
    ```json
    {
      "content": [
        {
          "author": "melodysdad",
          "body": "Issue description or comment text...",
          "timestamp": "2026-02-10T21:37:38Z"
        }
      ]
    }
    ```
  - `trace_context` — propagated traceparent/tracestate

## Dependencies

### Infrastructure
- SQS queue (subscribed to EventBridge rule for `projects_v2_item.ready`)
- EventBridge (for publishing outbound events)
- Database (for Conversation and Actor persistence)
- Lambda execution role with permissions for SQS, EventBridge, and database access

For database design decisions (engine choice, schema, partition keys, indexes, etc.), see [infrastructure.md](../policies/infrastructure.md). That document is the canonical source for all infrastructure architecture decisions.

### Environment Variables
- `GITHUB_TOKEN` — GitHub API authentication (for querying project items, user info, and comments)
- `EVENT_BUS_NAME` — EventBridge bus name for publishing events
- Database connection configuration (table name, endpoint, etc.)

### External Services
- GitHub GraphQL/REST API (for hydrating Conversation and Actor data, and fetching comments)
- Structured logging library (Pino or equivalent)
- Schema validation library (Zod or equivalent)
- AWS SDK (EventBridge, database client)

## Error Handling

### Event validation fails
- Log: warning level, operation, validation failure details, raw event
- Behavior: Do not process further; let SQS retry / send to DLQ
- No events emitted

### GitHub API call fails
- Log: error level, operation, API error details, item_node_id or sender_login
- Behavior: Do not process further; let SQS retry / send to DLQ
- Rationale: Transient GitHub failures should be retried by SQS, not in-Lambda

### Database write fails
- Log: error level, operation, database error details, entity being written
- Behavior: Do not process further; let SQS retry / send to DLQ
- IMPORTANT: If Conversation was persisted but Actor write fails, the retry will find the existing Conversation (step 2 is idempotent) and only reattempt the Actor

### EventBridge publish fails
- Log: error level, operation, publish failure details, event type
- Behavior: Do not process further; let SQS retry / send to DLQ

### Unexpected error
- Log: error level, full error context, stack trace
- Behavior: Let SQS retry / send to DLQ

## Idempotency
- **Conversation resolution** is idempotent: if the Conversation already exists, it is returned without modification
- **Actor resolution** is idempotent: if the Actor already exists, it is returned without modification
- **Content fetch** is idempotent: fetching comments from GitHub is a read operation; re-fetching the same range produces the same results
- **Event emission** is NOT idempotent: retries may produce duplicate `conversation_started`, `actor_created`, or `conversation_waiting` events — deduplication is the responsibility of downstream consumers, not the event processor

## Notes
- This is the **GitHub-specific** event processor. Future intake sources (Slack, SMS, email) will have their own event processors that resolve domain objects from their respective APIs and emit the same `conversation_waiting` event in the same normalized format.
- Steps 2 (Resolve Conversation) and 3 (Resolve Actor) are independent of each other and could be executed in parallel. Step 4 (Fetch Content) depends on the Conversation being resolved first (needs the Conversation ID to query for checkpoints).
- The `traceparent` from the incoming event should be propagated to all emitted events for distributed tracing.
- The content normalization in step 4 is the key abstraction boundary — everything downstream works with `{ author, body, timestamp }` content items regardless of source.
- Processing should be fast (Lambda timeout: 30s).
- All decisions (lookup hit/miss, API calls, persistence, event emission) must be logged per coding policy.
