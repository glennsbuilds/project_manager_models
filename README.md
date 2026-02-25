# Project Manager Models

Central contracts and code generation hub for the Project Manager system. This repo defines the domain model, service behaviors, and infrastructure policies — then generates TypeScript types, Zod validators, CloudEvent utilities, and CDK constructs consumed by all downstream services.

## Quick Start

```bash
npm install

# Generate TypeScript code from contracts
npm run generate

# Build all packages
npm run build
```

## What's in This Repo

### Contracts

The `contracts/` directory is the source of truth for the entire system. Nothing gets built without a contract.

| Directory | Purpose | Files |
|-----------|---------|-------|
| `contracts/domain/` | Core data model | **PRIMITIVES.md** (entities), **TRANSITIONS.md** (state transitions + events) |
| `contracts/services/` | Service behavior specs | **github_trigger.md**, **github_event_processor.md**, **conversation_pipeline.md** |
| `contracts/policies/` | Cross-cutting standards | **coding.md**, **infrastructure.md** |

### Code Generation

The generator reads contracts and produces typed code:

```bash
npm run generate
```

This writes to `packages/models/src/`:
- **types.ts** — TypeScript interfaces for all domain entities
- **schemas.ts** — Zod validators with inferred types for runtime validation
- **cloudEvents.ts** — CloudEvents v1.0 envelope, validator, and typed event creators

And to `packages/pipeline-cdk/src/`:
- **conversationPipeline.ts** — CDK construct defining the Step Function state machine, Lambda functions, and IAM grants

### Published Packages

| Package | Description |
|---------|-------------|
| `@melodysdad/pm-models` | Domain types, Zod schemas, CloudEvent utilities (auto-generated) |
| `@melodysdad/pm-pipeline-cdk` | CDK construct for conversation pipeline Step Function (auto-generated) |
| `@melodysdad/pm-transition-handlers` | Base handler classes for Lambda functions (`TransitionHandler<T>`) |
| `@melodysdad/pm-lambda-layer-utils` | Shared Lambda utilities (EventBridge publishing, error types) |

All packages are published to GitHub Packages via semantic-release on push to `main`.

## System Architecture

```
GitHub Webhook
  -> github-trigger Lambda
    -> EventBridge: project_manager.message.added
      -> SQS -> github-event-processor Lambda
        -> Resolves Conversation + Actor, fetches issue content
        -> EventBridge: project_manager.conversation_waiting
          -> SQS -> Conversation Pipeline (Step Function)
            1. Assemble context (checkpoint + new content)
            2. Summarizer Agent (Bedrock AgentCore)
            3. Architect Agent (Bedrock AgentCore)
            4. Route on decision:
               NEED_INFORMATION -> persist checkpoint, notify user
               BEGIN_WORK       -> persist checkpoint + tasks, invoke coding agents
               CLOSE_CONVERSATION -> persist checkpoint, notify user
```

The system is **source-agnostic** by design. GitHub is the first intake source, but the architecture supports Slack, email, and other sources — each with its own event processor that normalizes content into the shared domain model. Everything downstream of the event processors works with normalized `Conversation`, `Actor`, and `Message` primitives.

## Domain Model

Defined in `contracts/domain/PRIMITIVES.md`:

| Entity | Description |
|--------|-------------|
| **Actor** | A person, system, or AI that participates in conversations |
| **Conversation** | A tracked work item initiated by a human Actor |
| **ConversationCheckpoint** | An immutable decision point in a conversation's lifecycle |
| **Task** | A commitment to perform work, authorized by a checkpoint |
| **TaskCheckpoint** | An immutable record of task progress |
| **Message** | A contextual contribution from an Actor within a Conversation |

## Key Design Decisions

- **Contracts are authoritative.** If a service needs a primitive that doesn't exist, the contract gets updated first — not the code.
- **Events are triggers, not data carriers.** Events signal that something happened; consumers read the database for full context.
- **Checkpoints are immutable.** Each LLM processing round creates a new checkpoint with an updated summary. Prior checkpoints are retained for audit.
- **Source-agnostic pipeline.** The conversation pipeline never knows whether content came from GitHub, Slack, or email. All source-specific logic lives in the event processors.

## Development Workflow

1. Edit contracts in `contracts/domain/`, `contracts/services/`, or `contracts/policies/`
2. Run `npm run generate` to regenerate `packages/models/src/` and `packages/pipeline-cdk/src/`
3. Commit contract changes and regenerated code using [conventional commits](https://www.conventionalcommits.org/)
4. Push to `main` — semantic-release handles versioning and publishing

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details and [RELEASING.md](RELEASING.md) for commit conventions.
