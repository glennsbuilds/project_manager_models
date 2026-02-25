# Project Manager Models - Architecture

## Overview

This monorepo is the central contracts and code generation hub for the Project Manager system — an event-driven platform that takes work items from external sources (GitHub, Slack, etc.), processes them through AI agents, and orchestrates task execution.

The repo serves three purposes:

1. **Contracts** — the source of truth for domain models, state transitions, service behaviors, and policies
2. **Code generation** — parsers that read contracts and generate TypeScript types, Zod schemas, and CloudEvent utilities
3. **Published packages** — three npm packages consumed by downstream Lambda services

## Project Structure

```
.
├── contracts/
│   ├── domain/                      # Core data model
│   │   ├── PRIMITIVES.md            # Entity definitions (Actor, Conversation, Message, etc.)
│   │   └── TRANSITIONS.md           # State transitions and event schemas
│   ├── services/                    # Service-specific contracts
│   │   ├── github_trigger.md        # GitHub webhook intake lambda
│   │   ├── github_event_processor.md # GitHub event hydration + persistence
│   │   └── conversation_pipeline.md  # Step Function: AI agent orchestration
│   └── policies/                    # Cross-cutting standards
│       ├── coding.md                # Language, testing, handler patterns
│       └── infrastructure.md        # AWS, CDK, messaging, storage
│
├── src/                             # Code generation tools
│   ├── generate.ts                  # Orchestrator — reads contracts, writes to packages/models/src/
│   ├── parser.ts                    # PRIMITIVES.md parser
│   ├── transitionsParser.ts         # TRANSITIONS.md parser
│   ├── typeConverter.ts             # Markdown types → TypeScript/Zod mapping
│   ├── generateInterfaces.ts        # Generates types.ts
│   ├── generateSchemas.ts           # Generates schemas.ts
│   └── generateCloudEvents.ts       # Generates cloudEvents.ts
│
├── packages/
│   ├── models/                      # @melodysdad/pm-models (auto-generated)
│   │   └── src/
│   │       ├── types.ts             # TypeScript interfaces for all primitives
│   │       ├── schemas.ts           # Zod validators + inferred types
│   │       ├── cloudEvents.ts       # CloudEvent envelope, validators, typed creators
│   │       └── index.ts             # Package entry point
│   │
│   ├── handlers/                    # @melodysdad/pm-transition-handlers (hand-written)
│   │   └── src/
│   │       ├── baseHandler.ts       # TransitionHandler<T> abstract class
│   │       ├── githubWebhookHandler.ts # GitHub-specific handler base
│   │       └── index.ts
│   │
│   └── lambda-layer/               # @melodysdad/pm-lambda-layer-utils (hand-written)
│       └── src/
│           ├── cloudEvents.ts       # publishCloudEvent() — EventBridge publishing with trace propagation
│           ├── types.ts             # BusinessLogicInterface, HttpError
│           └── index.ts
│
├── ARCHITECTURE.md                  # This file
├── RELEASING.md                     # Semantic-release conventions
└── .github/workflows/
    └── release.yml                  # Automated publish via semantic-release
```

## Contracts

Contracts are the source of truth for the entire system. They are organized into three categories:

### Domain (`contracts/domain/`)

- **PRIMITIVES.md** — defines all entities (Actor, Conversation, ConversationCheckpoint, Task, TaskCheckpoint, Message) with their fields and types. The code generator reads this to produce TypeScript interfaces and Zod schemas.
- **TRANSITIONS.md** — defines state transitions (ConversationStarted, ConversationCheckpointCreated, TaskCreated, etc.) with their triggers, preconditions, state changes, and emitted events. The code generator reads this to produce CloudEvent helpers.

### Services (`contracts/services/`)

Each service contract defines a single deployable unit — its trigger, processing steps, events emitted, error handling, and idempotency guarantees.

- **github_trigger.md** — webhook intake Lambda that receives GitHub `projects_v2_item` edits and emits events to EventBridge
- **github_event_processor.md** — event processor Lambda that hydrates domain objects from GitHub, persists them, and emits `conversation_waiting` events
- **conversation_pipeline.md** — Step Function that orchestrates the conversation lifecycle through Bedrock AgentCore agents (summarizer, architect, decision routing)

### Policies (`contracts/policies/`)

Cross-cutting standards that apply to all services.

- **coding.md** — TypeScript/Node.js 22, Vitest, >80% coverage, handler template pattern, CommonJS exports for ADOT
- **infrastructure.md** — AWS, CDK v2, Lambda, DynamoDB single-table, EventBridge, CloudEvents, pay-per-use

## Code Generation Pipeline

```
contracts/domain/PRIMITIVES.md + contracts/domain/TRANSITIONS.md
    ↓
    npm run generate  (src/generate.ts)
    ↓
    packages/models/src/
      ├── types.ts        — TypeScript interfaces from PRIMITIVES.md
      ├── schemas.ts      — Zod validators from PRIMITIVES.md
      └── cloudEvents.ts  — CloudEvent types + creators from TRANSITIONS.md
```

The generator writes directly to `packages/models/src/`. There is no intermediate staging directory. Generated files are committed to git and published as part of the `@melodysdad/pm-models` package.

## Published Packages

All three packages are published to GitHub Packages (`npm.pkg.github.com`) via semantic-release on push to `main`.

| Package | npm Name | Source | Purpose |
|---------|----------|--------|---------|
| `packages/models` | `@melodysdad/pm-models` | Auto-generated from contracts | Domain types, Zod schemas, CloudEvent utilities |
| `packages/handlers` | `@melodysdad/pm-transition-handlers` | Hand-written | Base handler classes for Lambda functions |
| `packages/lambda-layer` | `@melodysdad/pm-lambda-layer-utils` | Hand-written | Shared Lambda utilities (EventBridge publishing, error types) |

## System Overview

```
GitHub Webhook
  → github-trigger Lambda
    → EventBridge: project_manager.message.added
      → SQS → github-event-processor Lambda
        → Resolves Conversation + Actor, fetches issue content
        → EventBridge: project_manager.conversation_waiting
          → SQS → Conversation Pipeline (Step Function)
            Step 1: Assemble context (checkpoint + new content)
            Step 2: Summarizer Agent (Bedrock AgentCore)
            Step 3: Architect Agent (Bedrock AgentCore)
            Step 4: Route on decision
               ├─ NEED_INFORMATION → persist checkpoint + message, notify user
               ├─ BEGIN_WORK → persist checkpoint + tasks, invoke coding agents
               └─ CLOSE_CONVERSATION → persist checkpoint, notify user
```

## Development Workflow

1. **Edit contracts** in `contracts/domain/`, `contracts/services/`, or `contracts/policies/`
2. **Run `npm run generate`** to regenerate `packages/models/src/` from domain contracts
3. **Commit** the contract changes and regenerated code
4. **Push to `main`** — semantic-release analyzes commits, bumps versions, and publishes packages

## Conventions

- Use [conventional commits](https://www.conventionalcommits.org/) — see [RELEASING.md](RELEASING.md)
- Domain contracts (PRIMITIVES, TRANSITIONS) are the single source of truth for data models
- Generated code in `packages/models/src/` should never be hand-edited — regenerate instead
- All services consume `@melodysdad/pm-models` for types and `@melodysdad/pm-lambda-layer-utils` for shared Lambda utilities
