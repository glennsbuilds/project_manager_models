# Conversation Pipeline Contract

## Overview
AWS Step Function that orchestrates the lifecycle of a conversation from intake through decision. It receives `conversation_waiting` events, assembles context for the LLM, invokes AI agents to analyze and triage the conversation, and routes to the appropriate next action based on the agent's decision.

This is the bridge between intake and intelligence. It absorbs the responsibilities originally planned for the conversation assembler service — checkpoint lookup, prompt composition, and new-vs-existing branching — as its first step, then orchestrates the agent pipeline.

All source-specific work (GitHub, Slack, etc.) happens upstream in the event processors. This pipeline is source-agnostic and works entirely with the normalized domain model.

## Pipeline Definition

### Metadata

```yaml
name: ConversationPipeline
type: STANDARD
source: project-manager.conversation-pipeline
```

### Trigger

```yaml
trigger:
  type: SQS
  event_source: "project-manager.*"
  detail_type: "project_manager.conversation_waiting"
```

### Input

```yaml
input:
  fields:
    - name: conversation_id
      type: GUID
      required: true
      description: Look up Conversation and its checkpoint history
    - name: actor_id
      type: GUID
      required: true
      description: Identify who triggered this round of the conversation
    - name: is_new
      type: boolean
      required: true
      description: Determines new vs. existing conversation assembly path
    - name: content
      type: array
      required: true
      description: Normalized content items from the source — already source-agnostic
      items:
        - name: author
          type: string
        - name: body
          type: string
        - name: timestamp
          type: timestamp
        - name: type
          type: string
    - name: traceparent
      type: string
      required: false
      description: Distributed trace context — propagate through all steps
```

### Steps

```yaml
steps:
  - name: AssembleContext
    type: Lambda
    description: >
      Prepares the conversation context for the AI agents. Absorbs the logic
      originally planned for the conversation assembler service.
    branch_on: "$.is_new"
    paths:
      true:
        description: "New conversation — use full content as context"
        reads: []
        composes: assembled_message from content + actor + system instructions
      false:
        description: "Existing conversation — fetch checkpoint, combine with new content"
        reads:
          - store: CheckpointStore
            query: latest checkpoint by conversation_id
        composes: assembled_message from checkpoint.summary + content + actor + continuation instructions
    output:
      - name: conversation_id
        type: GUID
      - name: actor_id
        type: GUID
      - name: is_new
        type: boolean
      - name: checkpoint_id
        type: GUID
        optional: true
      - name: assembled_message
        type: string
      - name: trace_context
        type: string
        optional: true
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 1
    errors:
      checkpoint_not_found:
        description: "Existing conversation has no checkpoint — unexpected state"
        action: FAIL

  - name: SummarizerAgent
    type: BedrockConverse
    model_id_env: SUMMARIZER_MODEL_ID
    prompt_contract: ../agents/summarizer.md
    description: >
      Distills the conversation into a structured analysis — intent, requirements,
      assumptions, approval status, and open questions. See agents/summarizer.md
      for the full prompt contract. Invokes the model directly via the Bedrock
      Converse API — no Bedrock Agent required.
    input: "$.assembled_message"
    user_message_template: "Here is the assembled conversation data:\n\n{}\n\nSummarize the intent of this conversation."
    pass_through:
      - conversation_id
      - actor_id
    output:
      - name: conversation_id
        type: GUID
      - name: summary
        type: object
        fields:
          - name: approval
            type: object
            fields:
              - name: status
                type: enum
                values: [APPROVED, PENDING]
              - name: approved_by
                type: string
                optional: true
              - name: approval_comment
                type: string
                optional: true
          - name: core_intent
            type: string
          - name: key_context
            type: string
          - name: stated_requirements
            type: string[]
          - name: implied_requirements
            type: string[]
          - name: inferred_assumptions
            type: string[]
          - name: open_questions
            type: string[]
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    timeout_seconds: 120

  - name: RouterAgent
    type: BedrockConverse
    model_id_env: ROUTER_MODEL_ID
    prompt_contract: ../agents/router_prompt.txt
    description: >
      Pure classifier — always routes, never asks for information or rejects.
      Classifies the task type (coding, shopping-list, etc.) and routes to the
      appropriate downstream service. NEED_INFORMATION and CLOSE_CONVERSATION
      decisions are the responsibility of downstream services (e.g., the
      architect agent in the codeinator for coding tasks).
    input: "$.summary"
    user_message_template: "Here is the conversation summary:\n\n{}\n\nClassify the task type."
    pass_through:
      - conversation_id
      - actor_id
      - summary
    output:
      - name: conversation_id
        type: GUID
      - name: actor_id
        type: GUID
      - name: summary
        type: object
      - name: taskType
        type: string
      - name: checkpoint_summary
        type: string
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    timeout_seconds: 120

  - name: PersistCheckpoint
    type: Lambda
    description: Create a ROUTED ConversationCheckpoint
    writes:
      - store: CheckpointStore
        entity: ConversationCheckpoint
        fields:
          conversation_id: "$.conversation_id"
          checkpoint_type: ROUTED
          summary: "$.checkpoint_summary"

  - name: EmitEvents
    type: Lambda
    description: Publish checkpoint.created and task.routed events
    emits:
      - event: project_manager.conversation.checkpoint.created
        transition: ConversationCheckpointCreated
      - event: project_manager.task.routed
        description: >
          Routes the task to a downstream service based on taskType.
          Downstream consumers filter on detail.taskType to receive
          only relevant events (e.g., codeinator filters on "coding").
        fields:
          conversation_id: "$.conversation_id"
          actor_id: "$.actor_id"
          taskType: "$.taskType"
          summary: "$.summary"

  - name: End
    type: Succeed
```

### Branches

_No branching — the router is a pure classifier that always routes. The pipeline
follows a linear path: AssembleContext → Summarize → Classify → PersistCheckpoint → EmitEvents → Succeed._

_NEED_INFORMATION and CLOSE_CONVERSATION decisions are handled by downstream
services (e.g., the architect agent in the codeinator) which emit their own
checkpoint events back to the event bus._

### Agents

```yaml
agents:
  - name: SummarizerAgent
    type: BedrockConverse
    model_id_env: SUMMARIZER_MODEL_ID
    prompt_contract: ../agents/summarizer.md
    description: >
      Distills conversation context into a structured analysis.
      Prompt contract: contracts/agents/summarizer.md
      Invokes model directly via Bedrock Converse API in the Step Function.
      System prompt passed as a construct prop at deployment time.

  - name: RouterAgent
    type: BedrockConverse
    model_id_env: ROUTER_MODEL_ID
    prompt_contract: ../agents/router_prompt.txt
    description: >
      Pure classifier — always routes, never asks for information or rejects.
      Classifies the task type for routing to downstream services.
      Prompt contract: contracts/agents/router_prompt.txt
      Invokes model directly via Bedrock Converse API in the Step Function.
      System prompt passed as a construct prop at deployment time.
```

### Environment Variables

```yaml
environment:
  - name: EVENT_BUS_NAME
    source: ssm
    parameter: /project-manager/event-bus-name
  - name: DYNAMODB_TABLE_NAME
    source: ssm
    parameter: /project-manager/dynamodb-table-name
  - name: SUMMARIZER_MODEL_ID
    source: ssm
    parameter: /project-manager/summarizer-model-id
  - name: ROUTER_MODEL_ID
    source: ssm
    parameter: /project-manager/router-model-id
```

### Error Handling

```yaml
error_handling:
  - step: AssembleContext
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 1
    on_failure: FAIL_EXECUTION
    notes: "SQS DLQ captures the original message"

  - step: SummarizerAgent
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    on_failure: FAIL_EXECUTION
    notes: "Direct Bedrock Converse API call — may fail on model throttling, timeouts"

  - step: RouterAgent
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    on_failure: FAIL_EXECUTION
    notes: "Direct Bedrock Converse API call — may fail on model throttling, timeouts"

  - step: "*Persist*"
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 1
    on_failure: FAIL_EXECUTION
    notes: "Use conditional writes to prevent duplicates on retry"

  - step: "*Emit*"
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 1
    on_failure: FAIL_EXECUTION
```

## Design Notes

- This pipeline is **source-agnostic**. It never knows whether the conversation originated from GitHub, Slack, or email. It works with normalized content and domain objects.
- The `conversation_waiting` event is the **single entry point** for all conversation processing — whether the conversation is new or the user is responding after a `NEED_INFORMATION` round-trip.
- The conversation assembler service contract (previously `conversation_assembler.md`, now deleted) is superseded by the AssembleContext step of this pipeline.
- Standard Step Function (not Express) is required because agent invocations may take 30+ seconds and the total pipeline may run for several minutes.
- The summarizer and router are separate agents to maintain single-responsibility and allow independent iteration on their prompts and capabilities. The router is a pure classifier — it always routes, never asks for information or rejects requests. NEED_INFORMATION and CLOSE_CONVERSATION decisions are the responsibility of downstream services. Domain-specific planning (e.g., the architect agent for coding tasks) is the responsibility of the downstream service (e.g., the codeinator).
- The pipeline never posts directly to GitHub or any other source. Outbound communication is triggered by the `project_manager.conversation.checkpoint.created` event — an outbound service listens for relevant checkpoint types (`NEED_INFORMATION`, `WORK_COMPLETED`, `CLOSE_CONVERSATION`) and handles the source-specific posting.

## Idempotency

- **Context assembly** is idempotent: same inputs produce the same assembled message
- **Agent invocations** are NOT idempotent: the LLM may produce different outputs on retry. This is acceptable — the checkpoint created will reflect whatever the agent decided on that execution.
- **Checkpoint writes** should be idempotent: use conditional writes to prevent duplicate checkpoints for the same pipeline execution
- **Task writes** should be idempotent: use the Step Function execution ID or a derived key to prevent duplicate tasks on retry
- **Event emission** is NOT idempotent: retries may produce duplicate events — downstream consumers must handle duplicates
