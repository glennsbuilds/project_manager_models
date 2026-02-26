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

  - name: ArchitectAgent
    type: BedrockAgentCore
    agent_id_env: ARCHITECT_AGENT_ID
    description: >
      Evaluates the summarized conversation and makes a triage decision.
      Determines if there's enough information to begin work, or if the
      pipeline should go back to the user.
    input: "$.SummarizerAgent.output + $.conversation_id + $.actor_id"
    output:
      - name: conversation_id
        type: GUID
      - name: decision
        type: enum
        values: [NEED_INFORMATION, BEGIN_WORK, CLOSE_CONVERSATION]
      - name: checkpoint_summary
        type: string
      - name: response_to_user
        type: string
        optional: true
      - name: tasks
        type: array
        optional: true
        items:
          - name: instructions
            type: string
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    timeout_seconds: 120

  - name: RouteOnDecision
    type: Choice
    input_field: "$.ArchitectAgent.output.decision"
    branches:
      - match: NEED_INFORMATION
        goto: BranchNeedInformation
      - match: BEGIN_WORK
        goto: BranchBeginWork
      - match: CLOSE_CONVERSATION
        goto: BranchCloseConversation
    default: FAIL
```

### Branches

```yaml
branches:
  - name: BranchNeedInformation
    steps:
      - name: PersistCheckpoint
        type: Lambda
        description: Create a NEED_INFORMATION ConversationCheckpoint
        writes:
          - store: CheckpointStore
            entity: ConversationCheckpoint
            fields:
              conversation_id: "$.conversation_id"
              checkpoint_type: NEED_INFORMATION
              summary: "$.ArchitectAgent.output.checkpoint_summary"
      - name: PersistMessage
        type: Lambda
        description: Create a Message from the AI response
        writes:
          - store: MessageStore
            entity: Message
            fields:
              actor_id: AI_ACTOR
              conversation_id: "$.conversation_id"
              content: "$.ArchitectAgent.output.response_to_user"
      - name: EmitCheckpointEvent
        type: Lambda
        description: Publish checkpoint.created event to EventBridge
        emits:
          - event: project_manager.conversation.checkpoint.created
            transition: ConversationCheckpointCreated
      - name: End
        type: Succeed

  - name: BranchBeginWork
    steps:
      - name: PersistCheckpoint
        type: Lambda
        description: Create a BEGIN_WORK ConversationCheckpoint
        writes:
          - store: CheckpointStore
            entity: ConversationCheckpoint
            fields:
              conversation_id: "$.conversation_id"
              checkpoint_type: BEGIN_WORK
              summary: "$.ArchitectAgent.output.checkpoint_summary"
      - name: PersistTasks
        type: Lambda  # Map state over $.ArchitectAgent.output.tasks
        description: Create Task entities for each task instruction
        writes:
          - store: TaskStore
            entity: Task
            fields:
              conversation_id: "$.conversation_id"
              checkpoint_id: "$.PersistCheckpoint.output.checkpoint_id"
              instructions: "$.instructions"
      - name: EmitEvents
        type: Lambda
        description: Publish checkpoint.created and task.created events
        emits:
          - event: project_manager.conversation.checkpoint.created
            transition: ConversationCheckpointCreated
          - event: project_manager.task.created
            transition: TaskCreated
            per_item: true
      - name: InvokeCodingAgents
        type: Placeholder
        description: "FUTURE WORK — Fan out to coding agent executions per task"
      - name: End
        type: Succeed

  - name: BranchCloseConversation
    steps:
      - name: PersistCheckpoint
        type: Lambda
        description: Create a CLOSE_CONVERSATION ConversationCheckpoint
        writes:
          - store: CheckpointStore
            entity: ConversationCheckpoint
            fields:
              conversation_id: "$.conversation_id"
              checkpoint_type: CLOSE_CONVERSATION
              summary: "$.ArchitectAgent.output.checkpoint_summary"
      - name: PersistMessage
        type: Lambda
        description: Create a Message if response_to_user is provided
        condition: "$.ArchitectAgent.output.response_to_user != null"
        writes:
          - store: MessageStore
            entity: Message
            fields:
              actor_id: AI_ACTOR
              conversation_id: "$.conversation_id"
              content: "$.ArchitectAgent.output.response_to_user"
      - name: EmitCheckpointEvent
        type: Lambda
        description: Publish checkpoint.created event to EventBridge
        emits:
          - event: project_manager.conversation.checkpoint.created
            transition: ConversationCheckpointCreated
      - name: End
        type: Succeed
```

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

  - name: ArchitectAgent
    type: BedrockAgentCore
    agent_id_env: ARCHITECT_AGENT_ID
    model: # configured externally, not in CDK
    description: >
      Evaluates summarized conversation and makes triage decisions.
      Prompt configuration is managed outside of infrastructure deployment.
    infrastructure_only: true  # CDK generates resource + IAM, not prompts
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
  - name: ARCHITECT_AGENT_ID
    source: ssm
    parameter: /project-manager/architect-agent-id
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

  - step: ArchitectAgent
    retry:
      max_attempts: 3
      backoff_rate: 2
      interval_seconds: 5
    on_failure: FAIL_EXECUTION
    notes: "Most likely failure point — model throttling, timeouts"

  - step: RouteOnDecision
    default: FAIL_EXECUTION
    notes: "Unknown decision value from architect agent"

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
- The summarizer and architect are separate agents to maintain single-responsibility and allow independent iteration on their prompts and capabilities. They could be collapsed into a single agent if the separation proves unnecessary.
- The pipeline never posts directly to GitHub or any other source. Outbound communication is triggered by the `project_manager.conversation.checkpoint.created` event — an outbound service listens for relevant checkpoint types (`NEED_INFORMATION`, `WORK_COMPLETED`, `CLOSE_CONVERSATION`) and handles the source-specific posting.

## Idempotency

- **Context assembly** is idempotent: same inputs produce the same assembled message
- **Agent invocations** are NOT idempotent: the LLM may produce different outputs on retry. This is acceptable — the checkpoint created will reflect whatever the agent decided on that execution.
- **Checkpoint writes** should be idempotent: use conditional writes to prevent duplicate checkpoints for the same pipeline execution
- **Task writes** should be idempotent: use the Step Function execution ID or a derived key to prevent duplicate tasks on retry
- **Event emission** is NOT idempotent: retries may produce duplicate events — downstream consumers must handle duplicates
