# Application Model

## Overview

An **application** is a named, versioned bundle of services that delivers a complete business function to a community. Applications deploy identically across all communities — same code, same infrastructure shape. Community-specific data is isolated within each community's DynamoDB table under the application's declared namespace.

Customization is achieved by **forking**: a forked application is a distinct application with its own name and version history. There is no configuration-based divergence within a single application definition.

---

## Application Manifest

Every application is described by a manifest. The manifest is the authoritative definition of what an application is and what it needs.

```yaml
# Required
name: string                  # Unique identifier, kebab-case (e.g. "project-tracker")
version: string               # Semantic version (e.g. "1.0.0")
display_name: string          # Human-readable name (e.g. "Project Tracker")
description: string           # One or two sentences shown in the marketplace

# Optional metadata
author: string                # Publisher name
forked_from?: string          # Original application name if this is a fork

# Data ownership
# Declares the DynamoDB key namespace this application owns within the
# community table. No two installed applications may share a namespace.
data:
  namespace: string           # Uppercase prefix (e.g. "PROJECT", "TASK")
  entities:                   # Entity types this application owns
    - name: string            # Entity name (e.g. "Project", "Task")
      description?: string

# EventBridge contracts
# Documents what events this application produces and consumes.
# Agents and services must honour these contracts exactly.
events:
  emits:
    - type: string            # CloudEvents type (e.g. "project_manager.task.created")
      description?: string
  consumes:
    - type: string            # CloudEvents type this application subscribes to
      source?: string         # Expected source filter (e.g. "project-manager.conversation-pipeline")
      description?: string

# Infrastructure components
# Informational — lists the deployed units that make up this application.
# Actual CDK definitions live in the application's repository.
components:
  - type: enum                # Lambda | StepFunction | SQSQueue | EventBridgeRule
    name: string
    description?: string
```

---

## Example — Project Tracker

```yaml
name: project-tracker
version: 1.0.0
display_name: Project Tracker
description: >
  Manages projects and tasks for a community. Processes conversations through
  an AI pipeline and routes work to coding agents or human task assignments.
author: melodysdad

data:
  namespace: PROJECT
  entities:
    - name: Project
      description: A unit of work scoped to a community
    - name: Task
      description: A commitment to perform work authorized by a ConversationCheckpoint

events:
  emits:
    - type: project_manager.task.created
    - type: project_manager.github_issue_updated
  consumes:
    - type: project_manager.message.added
      source: project-manager.github-trigger
    - type: project_manager.checkpoint.created
      source: project-manager.conversation-pipeline

components:
  - type: StepFunction
    name: ConversationPipeline
    description: Orchestrates intake through AI triage and routing
  - type: Lambda
    name: github_event_processor
    description: Processes GitHub project item events into conversations
  - type: Lambda
    name: github_issue_updater
    description: Posts AI responses as GitHub issue comments and updates project status
```

---

## Design Rules

- **One namespace per application.** An application owns its key prefix in the community table exclusively. It must not read or write keys owned by another application.
- **Platform primitives are shared.** The platform layer owns `CONVERSATION#`, `ACTOR#`, `MESSAGE#`, `COMMUNITY#`, and `APPLICATION#` keys. Applications read platform primitives but do not write them directly — they trigger platform events that cause writes.
- **No cross-community data access.** An application instance in Community A cannot access data from Community B. Data federation is deferred.
- **Forks are independent.** A forked application has no runtime relationship to its parent. It is a new application that happens to share lineage.
- **Versioning is opt-in per community.** Communities choose when to upgrade. The deployment mechanism uses Lambda versions and aliases to support gradual rollouts.
