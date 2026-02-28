# Platform Architecture Overview

## Purpose

This document is the starting point for understanding the system. It describes what the platform is, how it is structured, and how its parts communicate. Read this before reading any other contract.

**Architect agent**: Read this document in full before responding to any user request. It defines the context you are operating in.

---

## What the Platform Is

A multi-tenant platform that gives communities an AI-assisted workspace. Communities converse with the system through familiar tools (GitHub Issues, Slack, etc.) and the platform handles intake, understanding, routing, and response — powered by AI agents and an event-driven pipeline.

The platform has two layers of capability:

- **Baseline** — every community gets this automatically: conversational intake, AI triage pipeline, task generation, and response back to the originating channel
- **Applications** — optional additional capabilities a community can install from the catalog (see `APPLICATION_CATALOG.md`)

---

## Structural Layers

The platform has three structural layers. Understanding which layer owns what is essential before designing anything.

```
┌─────────────────────────────────────────────────────┐
│  Platform Layer                                      │
│  Owns: Community, Actor, Conversation, Checkpoint,  │
│        Message, InstalledApplication                 │
│  Infrastructure: DynamoDB table, EventBridge bus     │
│  (one of each per community)                         │
├─────────────────────────────────────────────────────┤
│  Application Layer                                   │
│  Owns: application-specific entities (e.g. Task)    │
│  Infrastructure: Lambda, Step Functions,             │
│        EventBridge rules (shared per platform)       │
├─────────────────────────────────────────────────────┤
│  Data Layer                                          │
│  Single DynamoDB table per community                 │
│  Platform and all applications share this table      │
│  Partitioned by key namespace (CONVERSATION#, TASK#) │
└─────────────────────────────────────────────────────┘
```

### What each layer owns

| Layer | DynamoDB key namespaces | Who can write |
|-------|------------------------|---------------|
| Platform | `COMMUNITY#`, `ACTOR#`, `CONVERSATION#`, `MESSAGE#`, `APPLICATION#` | Platform services only |
| project-tracker app | `TASK#`, `PROJECT#` | project-tracker services only |
| (future applications) | Their declared namespace | That application's services only |

No application may write to another application's namespace or to platform-owned keys.

---

## Community Model

A **Community** is the top-level tenant. Each community gets:
- Its own DynamoDB table
- Its own EventBridge bus
- Its own set of installed applications
- Fully isolated data — no cross-community data access

Communities are identified by a GUID. All SSM parameters are scoped to the community's deployment:

| SSM Parameter | Value |
|---------------|-------|
| `/project-manager/dynamodb-table-name` | Community DynamoDB table name |
| `/project-manager/dynamodb-table-arn` | Community DynamoDB table ARN |
| `/project-manager/event-bus-name` | Community EventBridge bus name |
| `/project-manager/event-bus-arn` | Community EventBridge bus ARN |
| `/project-manager/github-token-secret-name` | GitHub token secret name |

All services reference shared resources via SSM — never hardcode names or ARNs.

---

## Event-Driven Communication

Services communicate exclusively through **EventBridge events**. No service invokes another service directly (except Step Function → Lambda, which is internal to a pipeline).

### Event format

All events use **CloudEvents v1.0** structured JSON:

```json
{
  "specversion": "1.0",
  "id": "<request-id>",
  "source": "project-manager.<service-name>",
  "type": "project_manager.<entity>.<past-tense-action>",
  "time": "<iso-timestamp>",
  "datacontenttype": "application/json",
  "traceparent": "<w3c-trace-context>",
  "data": { }
}
```

### Naming conventions

- **Source**: `project-manager.<service-name>` (e.g. `project-manager.github-trigger`)
- **Type**: `project_manager.<entity>.<action>` (e.g. `project_manager.message.added`)
- All defined event types are in `contracts/domain/TRANSITIONS.md`

### Currently active events

| Type | Source | Description |
|------|--------|-------------|
| `project_manager.message.added` | `project-manager.github-trigger` | New content received from an intake channel |
| `project_manager.checkpoint.created` | `project-manager.conversation-pipeline` | AI pipeline completed a triage round |
| `project_manager.github_issue_updated` | `project-manager.github-issue-updater` | Comment posted + project status updated |

---

## End-to-End Flow

This is the full journey of a request from a community member to an AI response. Refer to this when reasoning about where a new capability should attach.

```
1. Human creates or updates a GitHub project item

2. github_trigger Lambda
   Receives GitHub webhook → validates signature
   Publishes: project_manager.message.added

3. github_event_processor Lambda
   Triggered by: project_manager.message.added (via SQS)
   Creates or resolves: Conversation, Actor
   Fetches content from GitHub
   Publishes: project_manager.conversation_waiting (to ConversationPipeline SQS)

4. ConversationPipeline Step Function
   Triggered by: project_manager.conversation_waiting (via SQS)

   Steps:
   a. AssembleContext    — builds prompt from conversation history + new content
   b. SummarizerAgent   — Bedrock Converse: distills intent, requirements, assumptions
   c. ArchitectAgent    — Bedrock Converse: makes triage decision
   d. RouteOnDecision   — routes to branch based on decision

   Branches:
   - NEED_INFORMATION  → PersistCheckpoint → PersistMessage → EmitCheckpointEvent
   - BEGIN_WORK        → PersistCheckpoint → PersistTasks → EmitEvents
   - CLOSE_CONVERSATION → PersistCheckpoint → PersistMessage → EmitCheckpointEvent

5. EmitCheckpointEvent Lambda
   Publishes: project_manager.checkpoint.created
   (source: project-manager.conversation-pipeline)

6. github_issue_updater Lambda
   Triggered by: project_manager.checkpoint.created
   Looks up Conversation in DynamoDB → gets GitHub project item node_id
   Resolves linked GitHub issue via GraphQL
   Posts response_to_user as issue comment
   Updates project item status to "In Review"
   Publishes: project_manager.github_issue_updated
```

---

## Application Structure

Every application follows the same structure. See `contracts/platform/APPLICATION_MODEL.md` for the full specification.

Key points:
- Applications are defined by a **manifest** (name, version, data namespace, events, components)
- Each application owns a **DynamoDB key namespace** — it reads and writes only within that namespace
- Applications communicate with the platform and each other exclusively through **EventBridge events**
- Applications deploy identically to every community — no per-community configuration
- Customization is achieved by **forking** (creating a new application), not configuration

---

## Architect Agent Decision Guide

When a user makes a request, follow this sequence:

### 1. Check the catalog first
Read `contracts/platform/APPLICATION_CATALOG.md`. Does an existing application already provide what the user needs, in full or in part? If yes, recommend installation rather than building.

### 2. Check the data model
Read `contracts/domain/PRIMITIVES.md`. Does the request require a new primitive, or can it be served by existing ones? If a new primitive is needed, define it before designing any service.

### 3. Check the event contracts
Read `contracts/domain/TRANSITIONS.md`. Does the request require a new event type, or can it listen to an existing one? If a new event type is needed, define it before designing any service.

### 4. Design within the layering rules
- Platform primitives (Conversation, Actor, Message, etc.) are written by platform services. Applications read them but trigger writes via events.
- New application data goes in the application's declared namespace.
- No cross-community data access.
- No direct service-to-service invocation — use EventBridge.

### 5. Follow the policies
- Infrastructure: `contracts/policies/infrastructure.md`
- Coding standards: `contracts/policies/coding.md`
- Application model: `contracts/platform/APPLICATION_MODEL.md`

---

## Agent Context vs Runtime Queries

Agents receive two categories of information:

**Injected as context (static — always provided upfront)**
The documents in this library. Read these to understand rules, data models, available applications, and how to design solutions.

**Queried at runtime via MCP server (dynamic — query when you need live state)**
The Platform MCP Server (`contracts/platform/MCP_SERVER.md`) provides live community and application inventory state. Use it to check what is actually installed in a community, trigger installs, and manage rollouts.

The rule of thumb: if the answer could change between two requests, use the MCP server. If the answer is the same for everyone, it's in the document library.

---

## Key Contracts Reference

| Document | Purpose |
|----------|---------|
| `contracts/domain/PRIMITIVES.md` | All data entities — the source of truth for data models |
| `contracts/domain/TRANSITIONS.md` | All event types and their lifecycle rules |
| `contracts/platform/APPLICATION_CATALOG.md` | Available applications — check before building anything new |
| `contracts/platform/APPLICATION_MODEL.md` | How to define a new application |
| `contracts/platform/COMMUNITY_CONFIGURATION.md` | Community and InstalledApplication data model |
| `contracts/platform/MCP_SERVER.md` | Operational interface — live community state and application inventory |
| `contracts/policies/infrastructure.md` | AWS infrastructure rules and patterns |
| `contracts/policies/coding.md` | TypeScript coding standards and handler structure |
