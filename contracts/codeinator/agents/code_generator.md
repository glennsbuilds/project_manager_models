# Code Generator Agent Contract

## Overview

The Code Generator Agent is the primary code generation step in the codeinator pipeline. It receives a structured behavioral contract (produced by the Architect Agent and stored in S3) and generates TypeScript source files conforming to the requested template type.

> **Note on prompt:** The system prompt for this agent is generated dynamically at invocation time. It is constructed from the template type, coding standards, and relevant platform context. There is no static prompt file — see `policies/coding.md` for the standards that govern generated output.

## Position in Pipeline

```
begin-work event → [Code Generator Agent] → Code Fixer Agent → Publish Artifacts
```

- **Receives:** behavioral contract JSON from S3 (fetched via `contractS3Key` in the `begin-work` event)
- **Produces:** generated TypeScript source files for the requested template type

## Input Shape

The agent receives the contract JSON uploaded by the Architect Agent:

```typescript
interface CodeGenerationContract {
  behavioralContract: string;      // Plain English: inputs, outputs, conditions, DynamoDB access, events emitted
  parsedInputSpec: string;         // TypeScript interface definitions as a string
  samplePayloads: Array<{
    filename: string;              // e.g. "status_changed.json"
    content: string;               // JSON payload as a string
  }>;
}
```

Along with metadata from the `begin-work` event:

| Field | Description |
|-------|-------------|
| `templateType` | `sqs-lambda`, `api-gateway`, or `step-function-handler` |
| `triggerName` | Handler name in kebab-case |
| `webhookEvent` | GitHub event header value (`api-gateway` only) |
| `webhookAction` | GitHub action field value (`api-gateway` only) |

## Output Shape

Generated files vary by template type. See `CODE_GENERATION.md` for the full list of files produced per template type.

| Template Type | Generated Files |
|---|---|
| `sqs-lambda` | `handler.ts`, `executeBusinessLogic.ts`, `broadcastEvent.ts`, `handler.test.ts` |
| `api-gateway` | `handler.ts`, `executeBusinessLogic.ts`, `broadcastEvent.ts`, `handler.test.ts` |
| `step-function-handler` | `handler.ts`, `handler.test.ts` |

## Design Notes

- **Dynamic prompt:** The system prompt is built at runtime to include the correct template scaffold, coding standards, and platform context. This allows new template types and coding standards to be applied without modifying the agent invocation logic.
- **Single responsibility:** This agent only generates code — it does not validate, test, or fix it. Validation is the Code Fixer Agent's responsibility.
- **Standards-driven output:** All generated code must conform to `policies/coding.md`. The dynamic prompt injects relevant sections of that document to constrain output style, structure, and testing requirements.
- **No infrastructure decisions:** The agent generates Lambda handler code only. CDK infrastructure (queues, rules, IAM) is handled separately by the codeinator CDK stack and is not part of this agent's output.
