# GitHub Event Processor - Implementation Guide

## Purpose
This document provides step-by-step instructions for implementing the GitHub Event Processor Lambda function. For the complete behavioral contract and requirements, see [github_event_processor.md](github_event_processor.md).

## Prerequisites

### Dependencies
```json
{
  "dependencies": {
    "@aws-sdk/client-eventbridge": "^3.x",
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/lib-dynamodb": "^3.x",
    "@octokit/graphql": "^7.x",
    "zod": "^3.x",
    "pino": "^8.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/aws-lambda": "^8.x",
    "vitest": "^1.x",
    "typescript": "^5.x"
  }
}
```

### Environment Variables
```typescript
// Required environment variables
GITHUB_TOKEN: string           // GitHub API authentication
EVENT_BUS_NAME: string         // EventBridge bus name
CONVERSATIONS_TABLE: string    // DynamoDB table for Conversations
ACTORS_TABLE: string          // DynamoDB table for Actors
CHECKPOINTS_TABLE: string     // DynamoDB table for ConversationCheckpoints
AWS_REGION: string            // AWS region (auto-provided by Lambda)
```

## File Structure

```
src/
├── handlers/
│   └── github-event-processor.ts          # Main Lambda handler
├── services/
│   ├── conversation-service.ts            # Conversation resolution & persistence
│   ├── actor-service.ts                   # Actor resolution & persistence
│   ├── github-service.ts                  # GitHub API interactions
│   ├── checkpoint-service.ts              # ConversationCheckpoint queries
│   └── event-service.ts                   # EventBridge publishing
├── schemas/
│   ├── input-event.schema.ts              # Zod schema for incoming event
│   ├── conversation.schema.ts             # Conversation domain type
│   ├── actor.schema.ts                    # Actor domain type
│   └── checkpoint.schema.ts               # ConversationCheckpoint type
├── utils/
│   ├── logger.ts                          # Pino logger configuration
│   └── errors.ts                          # Custom error types
└── types/
    └── github.ts                          # GitHub API response types

tests/
├── integration/
│   └── github-event-processor.test.ts    # End-to-end handler tests
├── unit/
│   ├── conversation-service.test.ts
│   ├── actor-service.test.ts
│   └── github-service.test.ts
└── fixtures/
    ├── events.ts                          # Sample SQS/EventBridge events
    └── github-responses.ts                # Mock GitHub API responses
```

## Implementation Steps

### Step 1: Set Up Core Infrastructure

#### 1.1 Create Logger (utils/logger.ts)
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Structured logging for CloudWatch
  base: {
    service: 'github-event-processor',
  },
});

// Helper for logging with trace context
export function withTrace(traceparent?: string) {
  return traceparent ? logger.child({ traceparent }) : logger;
}
```

#### 1.2 Define Custom Errors (utils/errors.ts)
```typescript
export class ValidationError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class GitHubAPIError extends Error {
  constructor(message: string, public statusCode?: number, public details?: unknown) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}
```

### Step 2: Define Schemas (schemas/)

#### 2.1 Input Event Schema (schemas/input-event.schema.ts)
```typescript
import { z } from 'zod';

export const InputEventSchema = z.object({
  version: z.string(),
  id: z.string(),
  'detail-type': z.literal('projects_v2_item.ready'),
  source: z.literal('project-manager.github-trigger'),
  account: z.string(),
  time: z.string(),
  region: z.string(),
  resources: z.array(z.unknown()),
  detail: z.object({
    specversion: z.string(),
    id: z.string(),
    source: z.string(),
    type: z.string(),
    time: z.string(),
    datacontenttype: z.string(),
    traceparent: z.string().optional(),
    tracestate: z.string().nullable().optional(),
    data: z.object({
      item_id: z.number(),
      item_node_id: z.string(),
      field_type: z.string(),
      field_name: z.string(),
      to_value: z.string(),
      from_value: z.string().nullable(),
      sender_login: z.string(),
      organization_login: z.string(),
    }),
  }),
});

export type InputEvent = z.infer<typeof InputEventSchema>;
```

#### 2.2 Domain Schemas
Reference [PRIMITIVES.md](PRIMITIVES.md) for the complete schemas. Create Zod schemas for:
- `Conversation` (schemas/conversation.schema.ts)
- `Actor` (schemas/actor.schema.ts)
- `ConversationCheckpoint` (schemas/checkpoint.schema.ts)

### Step 3: Implement GitHub Service (services/github-service.ts)

```typescript
import { graphql } from '@octokit/graphql';
import { logger } from '../utils/logger';
import { GitHubAPIError } from '../utils/errors';

export class GitHubService {
  private client: typeof graphql;

  constructor(token: string) {
    this.client = graphql.defaults({
      headers: { authorization: `token ${token}` },
    });
  }

  /**
   * Fetch ProjectV2 item details for Conversation creation
   */
  async fetchProjectItem(itemNodeId: string) {
    logger.info({ operation: 'fetchProjectItem', itemNodeId }, 'Fetching project item from GitHub');

    try {
      const result = await this.client<any>(`
        query($nodeId: ID!) {
          node(id: $nodeId) {
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
      `, { nodeId: itemNodeId });

      logger.info({ operation: 'fetchProjectItem', itemNodeId }, 'Successfully fetched project item');
      return result.node;
    } catch (error: any) {
      logger.error({ operation: 'fetchProjectItem', itemNodeId, error }, 'Failed to fetch project item');
      throw new GitHubAPIError('Failed to fetch project item', error.status, error);
    }
  }

  /**
   * Fetch user information for Actor creation
   */
  async fetchUser(login: string) {
    logger.info({ operation: 'fetchUser', login }, 'Fetching user from GitHub');

    try {
      const result = await this.client<any>(`
        query($login: String!) {
          user(login: $login) {
            id
            login
            name
            avatarUrl
          }
        }
      `, { login });

      logger.info({ operation: 'fetchUser', login }, 'Successfully fetched user');
      return result.user;
    } catch (error: any) {
      logger.error({ operation: 'fetchUser', login, error }, 'Failed to fetch user');
      throw new GitHubAPIError('Failed to fetch user', error.status, error);
    }
  }

  /**
   * Fetch comments for content assembly
   * IMPORTANT: Automatically paginates through ALL pages until hasNextPage is false
   */
  async fetchCommentsForItem(itemNodeId: string, afterTimestamp?: string): Promise<Array<{
    id: string;
    body: string;
    bodyHTML: string;
    author: { login: string };
    createdAt: string;
  }>> {
    logger.info({
      operation: 'fetchCommentsForItem',
      itemNodeId,
      afterTimestamp
    }, 'Fetching comments from GitHub');

    const allComments: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    try {
      while (hasNextPage) {
        const result = await this.client<any>(`
          query($nodeId: ID!, $after: String) {
            node(id: $nodeId) {
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
                comments(first: 100, after: $after) {
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
        `, { nodeId: itemNodeId, after: cursor });

        const comments = result.node.comments.nodes;

        // Filter by timestamp if checkpoint exists
        const filteredComments = afterTimestamp
          ? comments.filter((c: any) => c.createdAt > afterTimestamp)
          : comments;

        allComments.push(...filteredComments);

        hasNextPage = result.node.comments.pageInfo.hasNextPage;
        cursor = result.node.comments.pageInfo.endCursor;

        logger.info({
          operation: 'fetchCommentsForItem',
          itemNodeId,
          batchSize: comments.length,
          filteredSize: filteredComments.length,
          hasNextPage,
          totalFetched: allComments.length
        }, 'Fetched comments batch');
      }

      logger.info({
        operation: 'fetchCommentsForItem',
        itemNodeId,
        totalComments: allComments.length
      }, 'Successfully fetched all comments');

      return allComments;
    } catch (error: any) {
      logger.error({
        operation: 'fetchCommentsForItem',
        itemNodeId,
        error
      }, 'Failed to fetch comments');
      throw new GitHubAPIError('Failed to fetch comments', error.status, error);
    }
  }

  /**
   * Fetch item body/description along with initial fetch
   */
  async fetchItemContent(itemNodeId: string): Promise<{
    body: string;
    bodyHTML: string;
    title: string;
    createdAt: string;
  }> {
    logger.info({ operation: 'fetchItemContent', itemNodeId }, 'Fetching item content');

    try {
      const result = await this.client<any>(`
        query($nodeId: ID!) {
          node(id: $nodeId) {
            ... on ProjectV2Item {
              id
              title
              body
              bodyHTML
              createdAt
              content {
                ... on Issue {
                  body
                  bodyHTML
                }
                ... on PullRequest {
                  body
                  bodyHTML
                }
                ... on DraftIssue {
                  body
                  bodyHTML
                }
              }
            }
          }
        }
      `, { nodeId: itemNodeId });

      const node = result.node;
      const contentBody = node.content?.body || node.body || '';
      const contentBodyHTML = node.content?.bodyHTML || node.bodyHTML || '';

      logger.info({ operation: 'fetchItemContent', itemNodeId }, 'Successfully fetched item content');

      return {
        body: contentBody,
        bodyHTML: contentBodyHTML,
        title: node.title,
        createdAt: node.createdAt,
      };
    } catch (error: any) {
      logger.error({ operation: 'fetchItemContent', itemNodeId, error }, 'Failed to fetch item content');
      throw new GitHubAPIError('Failed to fetch item content', error.status, error);
    }
  }
}
```

### Step 4: Implement Checkpoint Service (services/checkpoint-service.ts)

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';

export interface ConversationCheckpoint {
  id: string;
  conversation_id: string;
  created_at: string;
  summary: string;
  // ... other fields per PRIMITIVES.md
}

export class CheckpointService {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.client = DynamoDBDocumentClient.from(ddbClient);
    this.tableName = process.env.CHECKPOINTS_TABLE!;
  }

  /**
   * Get the most recent checkpoint for a conversation
   */
  async getMostRecentCheckpoint(conversationId: string): Promise<ConversationCheckpoint | null> {
    logger.info({
      operation: 'getMostRecentCheckpoint',
      conversationId
    }, 'Querying for most recent checkpoint');

    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'conversation_id = :cid',
        ExpressionAttributeValues: {
          ':cid': conversationId,
        },
        ScanIndexForward: false, // Descending order
        Limit: 1,
      }));

      const checkpoint = result.Items?.[0] as ConversationCheckpoint | undefined;

      if (checkpoint) {
        logger.info({
          operation: 'getMostRecentCheckpoint',
          conversationId,
          checkpointId: checkpoint.id,
          createdAt: checkpoint.created_at
        }, 'Found checkpoint');
      } else {
        logger.info({
          operation: 'getMostRecentCheckpoint',
          conversationId
        }, 'No checkpoint found');
      }

      return checkpoint || null;
    } catch (error: any) {
      logger.error({
        operation: 'getMostRecentCheckpoint',
        conversationId,
        error
      }, 'Failed to query checkpoint');
      throw new DatabaseError('Failed to query checkpoint', error);
    }
  }
}
```

### Step 5: Implement Conversation Service (services/conversation-service.ts)

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import { GitHubService } from './github-service';

export interface Conversation {
  id: string;
  actor_ids: string[];
  title: string;
  external_id?: string;
  external_source?: string;
  status?: string;
  organization?: string;
  created_at: string;
  updated_at: string;
}

export class ConversationService {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private githubService: GitHubService;

  constructor(githubService: GitHubService) {
    const ddbClient = new DynamoDBClient({});
    this.client = DynamoDBDocumentClient.from(ddbClient);
    this.tableName = process.env.CONVERSATIONS_TABLE!;
    this.githubService = githubService;
  }

  /**
   * Resolve Conversation - idempotent operation
   * Returns existing Conversation or creates new one
   */
  async resolveConversation(
    itemNodeId: string,
    organizationLogin: string
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    logger.info({
      operation: 'resolveConversation',
      itemNodeId,
      organizationLogin
    }, 'Resolving conversation');

    // Step 1: Check if Conversation exists
    const existing = await this.findByExternalId(itemNodeId, 'github_projects_v2_item');

    if (existing) {
      logger.info({
        operation: 'resolveConversation',
        conversationId: existing.id,
        itemNodeId
      }, 'Found existing conversation');
      return { conversation: existing, isNew: false };
    }

    // Step 2: Fetch from GitHub
    const projectItem = await this.githubService.fetchProjectItem(itemNodeId);

    // Step 3: Extract field values
    const fieldValues = projectItem.fieldValues.nodes;
    const statusField = fieldValues.find((f: any) => f.field?.name === 'Status');

    // Step 4: Create new Conversation
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: uuidv4(),
      actor_ids: [], // Will be populated later
      title: projectItem.content?.title || projectItem.title || 'Untitled',
      external_id: itemNodeId,
      external_source: 'github_projects_v2_item',
      status: statusField?.name,
      organization: organizationLogin,
      created_at: now,
      updated_at: now,
    };

    // Step 5: Persist to database
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: conversation,
        ConditionExpression: 'attribute_not_exists(id)', // Prevent overwrites
      }));

      logger.info({
        operation: 'resolveConversation',
        conversationId: conversation.id,
        itemNodeId
      }, 'Created new conversation');

      return { conversation, isNew: true };
    } catch (error: any) {
      logger.error({
        operation: 'resolveConversation',
        itemNodeId,
        error
      }, 'Failed to persist conversation');
      throw new DatabaseError('Failed to persist conversation', error);
    }
  }

  private async findByExternalId(
    externalId: string,
    externalSource: string
  ): Promise<Conversation | null> {
    try {
      // Note: This assumes a GSI on external_id + external_source
      // Adjust based on actual table design from INFRASTRUCTURE.md
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          external_id: externalId,
          external_source: externalSource,
        },
      }));

      return result.Item as Conversation | null;
    } catch (error: any) {
      logger.error({
        operation: 'findByExternalId',
        externalId,
        error
      }, 'Failed to query conversation');
      throw new DatabaseError('Failed to query conversation', error);
    }
  }
}
```

### Step 6: Implement Actor Service (services/actor-service.ts)

Similar structure to ConversationService:
- `resolveActor(senderLogin: string): Promise<{ actor: Actor; isNew: boolean }>`
- `findByExternalIdentity(externalSource: string, identity: string): Promise<Actor | null>`
- Use GitHubService to fetch user info if Actor doesn't exist
- Persist to ACTORS_TABLE

**CRITICAL**: Set `type` to `HUMAN` for GitHub users per contract.

### Step 7: Implement Event Service (services/event-service.ts)

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../utils/logger';

export class EventService {
  private client: EventBridgeClient;
  private eventBusName: string;

  constructor() {
    this.client = new EventBridgeClient({});
    this.eventBusName = process.env.EVENT_BUS_NAME!;
  }

  async emitConversationStarted(conversation: any, traceparent?: string) {
    return this.emit('project_manager.conversation_started', conversation, traceparent);
  }

  async emitActorCreated(actor: any, traceparent?: string) {
    return this.emit('project_manager.actor_created', actor, traceparent);
  }

  async emitConversationWaiting(payload: {
    conversation_id: string;
    actor_id: string;
    is_new: boolean;
    content: Array<{ author: string; body: string; timestamp: string }>;
  }, traceparent?: string) {
    return this.emit('project_manager.conversation_waiting', payload, traceparent);
  }

  private async emit(type: string, data: any, traceparent?: string) {
    logger.info({ operation: 'emitEvent', type }, 'Publishing event to EventBridge');

    try {
      const event = {
        Time: new Date(),
        Source: 'project-manager.github-event-processor',
        DetailType: type,
        Detail: JSON.stringify({
          specversion: '1.0',
          id: crypto.randomUUID(),
          source: 'project-manager.github-event-processor',
          type,
          time: new Date().toISOString(),
          datacontenttype: 'application/json',
          traceparent,
          data,
        }),
        EventBusName: this.eventBusName,
      };

      await this.client.send(new PutEventsCommand({
        Entries: [event],
      }));

      logger.info({ operation: 'emitEvent', type }, 'Successfully published event');
    } catch (error: any) {
      logger.error({ operation: 'emitEvent', type, error }, 'Failed to publish event');
      throw error;
    }
  }
}
```

### Step 8: Main Handler (handlers/github-event-processor.ts)

```typescript
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { InputEventSchema } from '../schemas/input-event.schema';
import { GitHubService } from '../services/github-service';
import { ConversationService } from '../services/conversation-service';
import { ActorService } from '../services/actor-service';
import { CheckpointService } from '../services/checkpoint-service';
import { EventService } from '../services/event-service';
import { logger, withTrace } from '../utils/logger';
import { ValidationError } from '../utils/errors';

export async function handler(event: SQSEvent) {
  logger.info({ recordCount: event.Records.length }, 'Processing SQS batch');

  // Process records sequentially (can be parallelized if needed)
  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord) {
  let traceparent: string | undefined;

  try {
    // Step 1: Validate incoming event
    const body = JSON.parse(record.body);
    const validatedEvent = InputEventSchema.parse(body);
    traceparent = validatedEvent.detail.traceparent;

    const log = withTrace(traceparent);
    const { item_node_id, sender_login, organization_login } = validatedEvent.detail.data;

    log.info({
      operation: 'processRecord',
      itemNodeId: item_node_id,
      senderLogin: sender_login
    }, 'Processing validated event');

    // Initialize services
    const githubService = new GitHubService(process.env.GITHUB_TOKEN!);
    const conversationService = new ConversationService(githubService);
    const actorService = new ActorService(githubService);
    const checkpointService = new CheckpointService();
    const eventService = new EventService();

    // Step 2: Resolve Conversation
    const { conversation, isNew: conversationIsNew } = await conversationService.resolveConversation(
      item_node_id,
      organization_login
    );

    // Emit conversation_started if new
    if (conversationIsNew) {
      await eventService.emitConversationStarted(conversation, traceparent);
    }

    // Step 3: Resolve Actor
    const { actor, isNew: actorIsNew } = await actorService.resolveActor(sender_login);

    // Emit actor_created if new
    if (actorIsNew) {
      await eventService.emitActorCreated(actor, traceparent);
    }

    // Step 4: Fetch Content
    const checkpoint = await checkpointService.getMostRecentCheckpoint(conversation.id);

    let content: Array<{ author: string; body: string; timestamp: string }>;

    if (!checkpoint) {
      // New conversation: fetch item body + all comments
      log.info({ conversationId: conversation.id }, 'No checkpoint found, fetching all content');

      const itemContent = await githubService.fetchItemContent(item_node_id);
      const comments = await githubService.fetchCommentsForItem(item_node_id);

      content = [
        {
          author: sender_login, // Approximate - item creator
          body: itemContent.body,
          timestamp: itemContent.createdAt,
        },
        ...comments.map(c => ({
          author: c.author.login,
          body: c.body,
          timestamp: c.createdAt,
        })),
      ];
    } else {
      // Existing conversation: fetch only new comments after checkpoint
      log.info({
        conversationId: conversation.id,
        checkpointTimestamp: checkpoint.created_at
      }, 'Checkpoint found, fetching new comments only');

      const comments = await githubService.fetchCommentsForItem(
        item_node_id,
        checkpoint.created_at
      );

      content = comments.map(c => ({
        author: c.author.login,
        body: c.body,
        timestamp: c.createdAt,
      }));
    }

    log.info({
      conversationId: conversation.id,
      contentCount: content.length
    }, 'Content assembled');

    // Step 5: Emit conversation_waiting
    await eventService.emitConversationWaiting({
      conversation_id: conversation.id,
      actor_id: actor.id,
      is_new: conversationIsNew,
      content,
    }, traceparent);

    log.info({
      operation: 'processRecord',
      conversationId: conversation.id,
      actorId: actor.id
    }, 'Successfully processed record');

  } catch (error: any) {
    if (error instanceof ValidationError) {
      logger.warn({
        operation: 'processRecord',
        error: error.message,
        details: error.details
      }, 'Validation failed - sending to DLQ');
      // Let SQS handle DLQ routing
      throw error;
    }

    logger.error({
      operation: 'processRecord',
      error: error.message,
      stack: error.stack
    }, 'Unexpected error - retrying via SQS');

    // Re-throw to let SQS retry
    throw error;
  }
}
```

## Testing Strategy

### Unit Tests
- Test each service in isolation with mocked dependencies
- Mock GitHub API responses using fixtures
- Mock DynamoDB responses
- Focus on: error handling, pagination logic, data transformation

### Integration Tests
- Use LocalStack or DynamoDB Local for database
- Mock GitHub API with msw or nock
- Test full handler flow with sample events
- Verify events are emitted correctly

### Fixtures (tests/fixtures/events.ts)
```typescript
export const sampleSQSEvent = {
  Records: [{
    messageId: '...',
    receiptHandle: '...',
    body: JSON.stringify({
      version: '0',
      id: '246e2dfc-afef-177d-f2ab-aa1a510bb729',
      'detail-type': 'projects_v2_item.ready',
      source: 'project-manager.github-trigger',
      // ... rest of event from contract
    }),
    // ... other SQS fields
  }],
};
```

## Key Implementation Notes

### Pagination (CRITICAL)
- The `fetchCommentsForItem` method MUST loop through all pages
- Do NOT stop at first 100 comments
- Log each batch fetch for observability

### Error Handling Pattern
```typescript
try {
  // operation
} catch (error) {
  logger.error({ operation, error }, 'Operation failed');
  throw new CustomError('Message', details); // Let SQS retry
}
```

### Idempotency
- Conversation and Actor resolution are idempotent by design
- Use conditional writes where possible
- Event emission is NOT idempotent - downstream handles deduplication

### Logging Requirements (per CODING_POLICY.md)
- Log every decision: lookup hit/miss, API call, persistence, event emission
- Include operation name, relevant IDs, and trace context
- Use structured logging (JSON format)
- Error logs must include full context + stack trace

## Deployment

### Lambda Configuration
```yaml
Runtime: nodejs20.x
Timeout: 30
MemorySize: 512
Environment:
  GITHUB_TOKEN: !Ref GitHubToken
  EVENT_BUS_NAME: !Ref ProjectManagerEventBus
  CONVERSATIONS_TABLE: !Ref ConversationsTable
  ACTORS_TABLE: !Ref ActorsTable
  CHECKPOINTS_TABLE: !Ref CheckpointsTable
```

### IAM Permissions Required
- `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:Query` on all tables
- `events:PutEvents` on EventBridge bus
- `sqs:ReceiveMessage`, `sqs:DeleteMessage` on SQS queue
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

## References
- Behavioral Contract: [github_event_processor.md](github_event_processor.md)
- Domain Types: [PRIMITIVES.md](PRIMITIVES.md)
- Event Schemas: [TRANSITIONS.md](TRANSITIONS.md)
- Infrastructure Design: [INFRASTRUCTURE.md](INFRASTRUCTURE.md)
- Coding Standards: [CODING_POLICY.md](CODING_POLICY.md)
