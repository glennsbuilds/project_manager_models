# Code Generation

## Architect Agent: Read This First

Codeinator is the code generation engine for this platform. When a request requires new application
code, you trigger codeinator by firing a `begin-work` event with a structured behavioral contract.

This document tells you:
1. Which **template type** to request for a given infrastructure pattern
2. What **contract information** must be collected before triggering generation
3. What is **not supported** — decline these requests with a clear explanation

**Never** fire a `begin-work` event for a pattern not listed here. If a user's request cannot be
satisfied by one of the template types below, explain the constraint and ask the user to reconsider
their requirement.

---

## Template Types

### `sqs-lambda`

**Use when**: You need an event-driven Lambda triggered by an EventBridge event via an SQS queue.

**Examples**:
- Processing a `project_manager.message.added` event
- Reacting to a `project_manager.checkpoint.created` event
- Any async, decoupled event processor

**Infrastructure pattern**:
```
EventBridge rule → SQS queue → Lambda
```

**Generates**: `handler.ts` (factory wiring) + `executeBusinessLogic.ts` + `broadcastEvent.ts` + `handler.test.ts`

**Required contract fields**:

| Field | Description |
|-------|-------------|
| `triggerName` | Lambda name, kebab-case (e.g. `github_event_processor`) |
| `behavioralContract` | Plain English: what the handler does, inputs, outputs, conditions |
| `parsedInputSpec` | TypeScript `ParsedInput` interface extending `BusinessLogicInterface` |
| `samplePayloads` | Representative SQS message payloads for test generation |

**Deriving `parsedInputSpec`**: The fields listed under "Fact Emitted" in TRANSITIONS.md are the `data` fields delivered to your Lambda. Map each field directly to a TypeScript property in your `ParsedInput` interface. Optional fields become `field?: type`.

Example — `project_manager.message.added` event:
```typescript
import { BusinessLogicInterface } from '@melodysdad/pm-lambda-layer-utils';

export interface ParsedInput extends BusinessLogicInterface {
  type: string;
  field_name: string;
  from_value: string | null;
  to_value: string;
  item_node_id: string;
  sender_login: string;
  organization_login?: string;
}
```

---

### `api-gateway`

**Use when**: You need an HTTPS webhook receiver — to accept inbound webhooks from external services.

**Examples**:
- Receiving GitHub webhook events (`github_trigger`)
- Receiving Slack event notifications

**Infrastructure pattern**:
```
External service → API Gateway (HTTP API) → Lambda
```

**Generates**: `handler.ts` (factory wiring) + `executeBusinessLogic.ts` + `broadcastEvent.ts` + `handler.test.ts`

**Required contract fields**:

| Field | Description |
|-------|-------------|
| `triggerName` | Lambda name (e.g. `github_trigger`) |
| `webhookEvent` | Value of the `x-github-event` header (or equivalent) to match |
| `webhookAction` | Value of the `action` field in the payload to match |
| `behavioralContract` | Plain English: validation logic, processing, output events |
| `parsedInputSpec` | TypeScript `ParsedInput` interface extending `BusinessLogicInterface` |
| `samplePayloads` | Representative webhook payloads for test generation |

---

### `step-function-handler`

**Use when**: You need a single Lambda step inside a Step Functions pipeline.

**Examples**:
- `assembleContext` — builds conversation context for AI agents
- `persistCheckpoint` — writes a `ConversationCheckpoint` to DynamoDB
- `persistMessage` — writes a `Message` to DynamoDB
- `emitCheckpointEvent` — publishes an EventBridge event from pipeline state

**Infrastructure pattern**:
```
Step Functions state machine → Lambda → (returns updated state object)
```

**Generates**: `handler.ts` (fully AI-generated) + `handler.test.ts`

**Required contract fields**:

| Field | Description |
|-------|-------------|
| `triggerName` | Step name matching the pipeline definition (e.g. `assembleContext`) |
| `behavioralContract` | Plain English: full input state, output state, all branching logic, DynamoDB access patterns |
| `parsedInputSpec` | TypeScript `HandlerInput` and `HandlerOutput` interfaces |
| `samplePayloads` | Representative Step Functions state objects (one per significant branch) |

**Note**: The generated handler uses `export const handler = async (event: HandlerInput): Promise<HandlerOutput>`.
It uses `@aws-sdk/*` directly and does **not** import from `@melodysdad/pm-lambda-layer-utils`.

---

## What Is Not Supported

If a user request falls into any of these categories, do not attempt code generation. Explain the
constraint clearly and offer to help the user reframe their goal toward a supported pattern.

| Request type | What to say |
|---|---|
| Desktop applications (word processors, spreadsheets, IDEs, native apps) | "The platform builds serverless cloud backends on AWS Lambda. Desktop or native application development is not supported." |
| Mobile applications (iOS, Android, React Native) | "The platform builds serverless cloud backends on AWS Lambda. Mobile application development is not supported." |
| Standard websites (WordPress, static sites, landing pages) | "The platform runs entirely on Lambda. Web hosting infrastructure is not supported. If you need a public-facing endpoint, I can build one with API Gateway + Lambda." |
| Long-running servers or background daemons | "Lambda has a 15-minute maximum execution time and no persistent process model. For scheduled work, I can build an EventBridge Scheduler + Lambda. For long-running orchestration, I can build a Step Functions pipeline." |
| Real-time bidirectional communication (WebSockets, SSE) | "WebSocket and server-sent event infrastructure is not currently supported." |
| Relational databases (RDS, MySQL, Postgres) | "The platform uses DynamoDB exclusively. Relational databases are not supported." |
| Any AWS service not in `contracts/policies/infrastructure.md` | "That service is not on the approved list. I can propose an infrastructure exception, but cannot proceed without explicit approval." |

If the request doesn't fit any template type and isn't on this list, do not improvise. Ask the user
to describe the underlying goal — often a different framing maps cleanly to a supported pattern.

---

## Triggering Code Generation

When you have collected all required contract fields, upload the contract to S3 and fire the
`begin-work` event:

**Contract JSON** (uploaded to ContractsBucket before the event):
```json
{
  "behavioralContract": "plain English string",
  "parsedInputSpec": "TypeScript interface definitions as a string",
  "samplePayloads": [
    { "filename": "example_name.json", "content": "JSON payload as a string" }
  ]
}
```

**`begin-work` event detail**:
```json
{
  "issueId": "<github-issue-id>",
  "userId": "<requesting-user-id>",
  "templateType": "sqs-lambda | api-gateway | step-function-handler",
  "triggerName": "<handler-name>",
  "webhookEvent": "<x-github-event value, or empty string>",
  "webhookAction": "<action value, or empty string>",
  "contractS3Key": "<s3-key-of-uploaded-contract-json>"
}
```

`webhookEvent` and `webhookAction` are only meaningful for `api-gateway`. Pass empty strings for
`sqs-lambda` and `step-function-handler`.

---

## Shared Infrastructure References

When writing behavioral contracts, **never** ask the user for resource names or ARNs. All shared infrastructure is accessed via SSM parameters documented in `infrastructure.md`:

| Resource | SSM Parameter | Example Usage in Contract |
|----------|---------------|---------------------------|
| EventBridge bus | `/project-manager/event-bus-name` | "Reads event bus name from SSM parameter `/project-manager/event-bus-name` and publishes events to it" |
| DynamoDB table | `/project-manager/dynamodb-table-name` | "Reads table name from SSM parameter `/project-manager/dynamodb-table-name` and queries for conversation metadata" |
| GitHub token | `/project-manager/github-token-secret-name` | "Reads GitHub PAT from Secrets Manager using name from SSM parameter `/project-manager/github-token-secret-name`" |

**The codeinator CDK stack will automatically**:
- Read the SSM parameter values at synth time
- Inject them as environment variables into the Lambda
- Grant IAM permissions to access them

Your behavioral contract should describe **what** the Lambda does (e.g., "publishes events to the shared event bus"), not **how** to reference it in CDK. That's handled automatically.

---

## Keeping This Document Current

When codeinator gains a new template type, add an entry here following the format above. The
architect agent reads this document at invocation time — updating it here is sufficient to make
the new capability available without any redeployment.
