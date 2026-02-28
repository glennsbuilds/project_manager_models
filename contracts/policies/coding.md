# Coding Policy

## Architect Agent: Read This First

This policy defines how code is written and structured on this platform. If a user request requires a pattern not described here, **do not improvise**. Instead:

1. Tell the user what the constraint is
2. Ask whether the requirement can be redesigned to fit the approved patterns
3. If a genuinely new pattern is needed, ask the user to approve it and document it here before writing any code

**Never** invent a new file structure, handler pattern, or dependency strategy. Consistency across services is essential for the coding agents to work reliably.

---

## Code Lifecycle

- **Service code is disposable** — when a service needs to change, a new version is generated from scratch (V2Stack, V3Stack, etc.). Do not edit existing service code in place.
- **Contracts, policies, and tests are permanent** — these are the source of truth that survives version changes. Always update these before generating new service code.
- When asked to modify an existing service: create a new version, not a patch to the old one. Decommission the old version after the new one passes contract tests.

---

## Language and Runtime

- **TypeScript** — sole language for all Lambda functions and CDK infrastructure
- **Node.js 22.x LTS** — sole runtime
- **npm** — sole package manager (no yarn, pnpm, bun)
- **CommonJS output** — all Lambda bundles must output CommonJS for ADOT compatibility (esbuild `format: CJS`)

### TypeScript standards
- **Strict mode enabled** in all `tsconfig.json` files
- **No `any`** — use `unknown` and narrow it, or define a proper interface
- All function parameters and return types must be explicitly typed
- Prefer `interface` over `type` for object shapes

---

## Service Structure

Every Lambda service follows this directory layout:

```
lambdas/<service-name>/
  src/
    handler.ts              — Lambda entry point (do not modify the pipeline)
    validateAndAuthorize.ts — Input validation and auth
    executeBusinessLogic.ts — Core business logic (your main implementation target)
    broadcastEvent.ts       — EventBridge event publishing
    businessLogicInterface.ts — Shared input type
    utils.ts                — Inlined utilities (publishCloudEvent, etc.)
    errors.ts               — Service-specific error types
  infra/
    app.ts                  — CDK app entry point
    stack.ts                — CDK stack definition
    additional_infra.ts     — Hook for extra infrastructure (DynamoDB GSIs, rules, etc.)
  package.json
  tsconfig.json
  cdk.json
  collector.yaml            — OTEL collector config (required)
```

Do not deviate from this structure. Do not add top-level files that don't fit this layout without approval.

---

## Handler Pipeline

Every Lambda handler runs the same pipeline. **Do not modify the pipeline itself** — only implement the functions it calls.

```
handler.ts
  → validateAndAuthorize()   ← implement: Zod schema validation
  → executeBusinessLogic()   ← implement: all business logic
  → broadcastEvent()         ← implement: event payload data field
```

### Your implementation targets

1. **`validateAndAuthorize.ts`** — Define a Zod schema for the input payload. Throw on invalid input.
2. **`executeBusinessLogic.ts`** — All business work: DynamoDB reads/writes, external API calls, data transformation. Throw on unrecoverable errors.
3. **`broadcastEvent.ts`** — Call `publishCloudEvent()` with the appropriate event type and data payload.

The framework (handler.ts) handles: error catching, structured logging, trace context propagation, and the response envelope. Do not duplicate any of that in your implementation.

### Handler export

**CRITICAL**: All Lambda handlers must use CommonJS export for ADOT compatibility:

```typescript
// CORRECT
module.exports = { handler };

// WRONG — do not use
export async function handler(...) {}
export { handler };
```

---

## Step Function Handlers

Step Function step handlers are **different from Lambda service handlers**. They are plain CommonJS JavaScript files (not TypeScript) located in `infra/handlers/`.

```
infra/handlers/
  assembleContext.js
  summarizerAgent.js
  persistCheckpoint.js
  emitCheckpointEvent.js
  ...
```

### Pattern

```javascript
// infra/handlers/myStep.js
const { SomeClient, SomeCommand } = require('@aws-sdk/client-something');

const client = new SomeClient({});

module.exports.handler = async (event) => {
  console.log('MyStep', JSON.stringify(event));

  // Read from event state, do work, return updated state
  const { conversation_id } = event;

  // ... implementation ...

  return event; // Step Functions chains on the return value
};
```

Key rules for Step Function handlers:
- **CommonJS only** — `require()` and `module.exports`, no `import`/`export`
- **Return the event** (or a modified version of it) — Step Functions uses the return value as the next step's input
- **AWS SDK v3** — use `require('@aws-sdk/...')` (available in Lambda runtime, do not bundle)
- **No TypeScript** — these files are `.js`, not `.ts`

---

## Utilities

Do **not** import from `@melodysdad/pm-lambda-layer-utils` or any shared layer package. Each service inlines its own `utils.ts`.

The standard `utils.ts` for every Lambda service:

```typescript
// src/utils.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridgeClient = new EventBridgeClient({});

export async function publishCloudEvent(
  eventBusName: string,
  event: {
    source: string;
    type: string;
    data: any;
    traceCarrier: Record<string, string>;
    requestId: string;
  }
): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [{
        Source: event.source,
        DetailType: event.type,
        Detail: JSON.stringify({
          specversion: '1.0',
          id: event.requestId,
          source: event.source,
          type: event.type,
          time: new Date().toISOString(),
          datacontenttype: 'application/json',
          traceparent: event.traceCarrier.traceparent,
          data: event.data,
        }),
        EventBusName: eventBusName,
      }],
    })
  );
}
```

Copy this verbatim into every new service. Do not modify it.

---

## Dependencies

### AWS SDK
- **AWS SDK v3** (`@aws-sdk/*`) — available in the Lambda runtime, do not bundle
- Add to `package.json` dependencies for TypeScript type resolution
- Add to `externalModules` in CDK bundling config so esbuild does not bundle them

### Third-party packages
- Use well-established, actively maintained packages only
- Prefer packages already used elsewhere in the codebase before introducing new ones
- Do not add a package to solve a problem that can be solved with the standard library or AWS SDK

### CDK bundling config
```typescript
bundling: {
  minify: true,
  sourceMap: false,
  target: 'node22',
  format: cdk.aws_lambda_nodejs.OutputFormat.CJS,
  externalModules: [
    '@aws-sdk/*',  // provided by Lambda runtime
  ],
}
```

---

## Secrets Management

- **Never** hardcode secrets or put secret values in environment variables
- Environment variables hold the secret **name** only (e.g. `GITHUB_TOKEN_SECRET_NAME`)
- Lambda retrieves the secret at runtime using Secrets Manager and caches it in module scope:

```typescript
let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: process.env.MY_SECRET_NAME! })
  );
  if (!response.SecretString) throw new Error('Secret has no value');
  cachedToken = response.SecretString;
  return cachedToken;
}
```

---

## Testing

### Unit tests
- Framework: **Vitest**
- Coverage threshold: **80%** lines, branches, functions, statements
- Test `executeBusinessLogic()` in isolation — mock all external clients (DynamoDB, Secrets Manager, Octokit, etc.)
- Do not test the handler pipeline, logging, or error formatting — the framework owns those

### Contract tests
- Located in `test_suites/`
- Run against the deployed service, not mocks
- **Contract tests are the authoritative measure of correctness** — unit tests passing is necessary but not sufficient for deployment

### Deployment success criteria
1. Unit tests pass with >80% coverage
2. `cdk deploy` succeeds
3. All contract tests pass against deployed environment

---

## Structured Logging

All log statements use this JSON format:

```json
{
  "timestamp": "2026-02-14T12:00:00Z",
  "level": "info | warn | error",
  "operation": "operationName",
  "status": "success | error | skipped",
  "request_id": "uuid",
  // ... business-specific fields
}
```

Use `console.log` for info, `console.warn` for warnings, `console.error` for errors. Do not use a logging library.

---

## Observability

- OpenTelemetry is handled automatically by the **ADOT Lambda Layer** — do not install or configure OpenTelemetry manually
- Every Lambda bundle must include `collector.yaml` — copy it from an existing service
- The CDK bundling `afterBundling` hook must copy `collector.yaml` into the output directory:

```typescript
afterBundling: (inputDir: string, outputDir: string): string[] => [
  `cp ${inputDir}/collector.yaml ${outputDir}/collector.yaml`,
],
```
