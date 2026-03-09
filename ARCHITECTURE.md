# Project Manager Models - Architecture

## Overview

This monorepo is the central contracts and code generation hub for the Project Manager system — an event-driven platform that takes work items from external sources (GitHub, Slack, etc.), processes them through AI agents, and orchestrates task execution.

The repo serves three purposes:

1. **Contracts** — the source of truth for domain models, state transitions, service behaviors, and policies
2. **Code generation** — parsers that read contracts and generate TypeScript types, Zod schemas, CloudEvent utilities, and CDK constructs
3. **Published packages** — four npm packages consumed by downstream Lambda services and CDK stacks

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
│   ├── agents/                      # AI agent prompt contracts
│   │   └── summarizer.md            # Summarizer Agent: intent extraction + approval detection
│   └── policies/                    # Cross-cutting standards
│       ├── coding.md                # Language, testing, handler patterns
│       └── infrastructure.md        # AWS, CDK, messaging, storage
│
├── src/                             # Code generation tools
│   ├── generate.ts                  # Orchestrator — reads contracts, writes to packages/
│   ├── parser.ts                    # PRIMITIVES.md parser
│   ├── transitionsParser.ts         # TRANSITIONS.md parser
│   ├── pipelineParser.ts            # conversation_pipeline.md YAML parser
│   ├── typeConverter.ts             # Markdown types → TypeScript/Zod mapping
│   ├── generateInterfaces.ts        # Generates types.ts
│   ├── generateSchemas.ts           # Generates schemas.ts
│   ├── generateCloudEvents.ts       # Generates cloudEvents.ts
│   └── generateStepFunction.ts      # Generates CDK Step Function construct
│
├── packages/
│   ├── models/                      # @glennsbuilds/pm-models (auto-generated)
│   │   └── src/
│   │       ├── types.ts             # TypeScript interfaces for all primitives
│   │       ├── schemas.ts           # Zod validators + inferred types
│   │       ├── cloudEvents.ts       # CloudEvent envelope, validators, typed creators
│   │       └── index.ts             # Package entry point
│   │
│   ├── handlers/                    # @glennsbuilds/pm-transition-handlers (hand-written)
│   │   └── src/
│   │       ├── baseHandler.ts       # TransitionHandler<T> abstract class
│   │       ├── githubWebhookHandler.ts # GitHub-specific handler base
│   │       └── index.ts
│   │
│   ├── lambda-layer/               # @glennsbuilds/pm-lambda-layer-utils (hand-written)
│   │   └── src/
│   │       ├── cloudEvents.ts       # publishCloudEvent() — EventBridge publishing with trace propagation
│   │       ├── types.ts             # BusinessLogicInterface, HttpError
│   │       └── index.ts
│   │
│   └── pipeline-cdk/               # @glennsbuilds/pm-pipeline-cdk (auto-generated)
│       └── src/
│           ├── conversationPipeline.ts  # CDK construct: Step Function + Lambdas
│           └── index.ts
│
├── ARCHITECTURE.md                  # This file
├── RELEASING.md                     # Semantic-release conventions
└── .github/workflows/
    └── release.yml                  # Automated publish via semantic-release
```

## Contracts

Contracts are the source of truth for the entire system. They are organized into four categories:

### Domain (`contracts/domain/`)

- **PRIMITIVES.md** — defines all entities (Actor, Conversation, ConversationCheckpoint, Task, TaskCheckpoint, Message) with their fields and types. The code generator reads this to produce TypeScript interfaces and Zod schemas.
- **TRANSITIONS.md** — defines state transitions (ConversationStarted, ConversationCheckpointCreated, TaskCreated, etc.) with their triggers, preconditions, state changes, and emitted events. The code generator reads this to produce CloudEvent helpers.

### Services (`contracts/services/`)

Each service contract defines a single deployable unit — its trigger, processing steps, events emitted, error handling, and idempotency guarantees.

- **github_trigger.md** — webhook intake Lambda that receives GitHub `projects_v2_item` edits and emits events to EventBridge
- **github_event_processor.md** — event processor Lambda that hydrates domain objects from GitHub, persists them, and emits `conversation_waiting` events
- **conversation_pipeline.md** — Step Function that orchestrates the conversation lifecycle through Bedrock AgentCore agents (summarizer, architect, decision routing)

### Agents (`contracts/agents/`)

Each agent contract defines the prompt, input/output schema, and design rationale for a Bedrock AgentCore agent used in the conversation pipeline. These are the source of truth for agent behavior — infrastructure (IAM, resource creation) is defined in the service contracts; prompts and output schemas live here.

- **summarizer.md** — Summarizer Agent: extracts user intent, requirements, assumptions, approval status, and open questions from assembled conversation data

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

contracts/services/conversation_pipeline.md
    ↓
    npm run generate  (src/generate.ts)
    ↓
    packages/pipeline-cdk/src/
      └── conversationPipeline.ts  — CDK construct (StateMachine + Lambdas)
```

The generator writes directly to package source directories. There is no intermediate staging directory. Generated files are committed to git and published as part of their respective packages.

## Published Packages

All four packages are published to GitHub Packages (`npm.pkg.github.com`) via semantic-release on push to `main`.

| Package | npm Name | Source | Purpose |
|---------|----------|--------|---------|
| `packages/models` | `@glennsbuilds/pm-models` | Auto-generated from contracts | Domain types, Zod schemas, CloudEvent utilities |
| `packages/handlers` | `@glennsbuilds/pm-transition-handlers` | Hand-written | Base handler classes for Lambda functions |
| `packages/lambda-layer` | `@glennsbuilds/pm-lambda-layer-utils` | Hand-written | Shared Lambda utilities (EventBridge publishing, error types) |
| `packages/pipeline-cdk` | `@glennsbuilds/pm-pipeline-cdk` | Auto-generated from contracts | CDK construct for conversation pipeline (Step Function + Lambdas) |

## Infrastructure

This repo owns all CDK stacks for the platform:

| Stack | Purpose |
|-------|---------|
| `ProjectManagerBaseInfra` | Shared EventBridge bus, DynamoDB table, SSM parameters |
| `ProjectManagerParamsStack` | Bedrock model ID parameters for agents |
| `ConversationPipelineStack` | Step Function + Lambda handlers for conversation orchestration |

Deploy all stacks: `npx cdk deploy --all`
Deploy a single stack: `npx cdk deploy ProjectManagerBaseInfra`

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

## Vision

This platform is the **core dispatcher** for a broader system — not just a code generation pipeline. The long-term goal is a social network around creativity and community service, where communities organize around shared goals and build their own processes, rituals, celebrations, and commitment infrastructure.

### Three-layer architecture

1. **Social layer** — communities, members, shared goals, rituals, celebrations. The product people interact with.
2. **Project orchestration** — decomposing goals into tasks, tracking progress, managing dependencies across human and automated work. Owns task classification (human vs AI) and cross-task state.
3. **Executor layer** — specialized systems that carry out tasks. The code automation pipeline (codeinator) is the first executor; others will follow (event planning, communication, scheduling).

### Why this repo is the core

The infrastructure here — EventBridge bus, DynamoDB single table, conversation/checkpoint model, architect agent — is executor-agnostic by design. The prompts and the current executor (codeinator) are code-specific, but the dispatch pattern generalizes:

- Architect decomposes a goal into tasks, each tagged with an executor type
- `RouteOnDecision` dispatches to the right executor via EventBridge
- Executors emit completion events; the orchestration layer tracks progress
- Communities register their own executors through the service registry

### Evolution path

- **Now:** Architect triages → routes to codeinator (single executor, hardcoded)
- **Next:** Architect output includes `executor` field → routing dispatches to codeinator or flags for human action
- **Later:** Executor registry grows; communities define custom executors; multi-task projects track state across human and automated work

## Development Workflow

1. **Edit contracts** in `contracts/domain/`, `contracts/services/`, or `contracts/policies/`
2. **Run `npm run generate`** to regenerate `packages/models/src/` and `packages/pipeline-cdk/src/` from contracts
3. **Commit** the contract changes and regenerated code
4. **Push to `main`** — semantic-release analyzes commits, bumps versions, and publishes packages

## Conventions

- Use [conventional commits](https://www.conventionalcommits.org/) — see [RELEASING.md](RELEASING.md)
- Domain contracts (PRIMITIVES, TRANSITIONS) are the single source of truth for data models
- Generated code in `packages/models/src/` and `packages/pipeline-cdk/src/` should never be hand-edited — regenerate instead
- All services consume `@glennsbuilds/pm-models` for types and `@glennsbuilds/pm-lambda-layer-utils` for shared Lambda utilities
