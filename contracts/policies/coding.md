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

Structure varies by template type. See `contracts/platform/CODE_GENERATION.md` for the template
type selection guide.

### `sqs-lambda` and `api-gateway`

```
lambdas/<service-name>/
  src/
    handler.ts              — Factory wiring (createSQSHandler or createAPIGatewayWebhookHandler)
    executeBusinessLogic.ts — Core business logic: parse input, return ParsedInput
    broadcastEvent.ts       — Defines ParsedInput interface; conditionally publishCloudEvent
    handler.test.ts         — Vitest unit tests
  infra/
    app.ts                  — CDK app entry point
    stack.ts                — CDK stack definition
    additional_infra.ts     — Hook for extra infrastructure (DynamoDB GSIs, rules, etc.)
  package.json
  tsconfig.json
  cdk.json
  collector.yaml            — OTEL collector config (required)
```

### `step-function-handler`

```
lambdas/<pipeline-name>/handlers/
  <stepName>.ts             — Step handler: export const handler = async (event) => ...
  <stepName>.test.ts        — Vitest unit tests
```

Do not deviate from these structures without approval.

---

## Handler Pipeline

### `sqs-lambda` and `api-gateway` — factory pattern

Handler wiring is provided by `@glennsbuilds/pm-lambda-layer-utils`. The `handler.ts` file is
a thin wiring file only — do not add logic to it.

```typescript
// handler.ts (sqs-lambda)
import { createSQSHandler } from '@glennsbuilds/pm-lambda-layer-utils';
import { validateAndAuthorize } from './validateAndAuthorize';
import { executeBusinessLogic } from './executeBusinessLogic';
import { broadcastEvent } from './broadcastEvent';

module.exports = {
  handler: createSQSHandler('my-handler', { validateAndAuthorize, executeBusinessLogic, broadcastEvent }),
};
```

```typescript
// handler.ts (api-gateway)
import { createAPIGatewayWebhookHandler } from '@glennsbuilds/pm-lambda-layer-utils';
import { executeBusinessLogic } from './executeBusinessLogic';
import { broadcastEvent } from './broadcastEvent';

module.exports = {
  handler: createAPIGatewayWebhookHandler('my-handler', {
    webhookEvent: 'projects_v2_item',
    webhookAction: 'edited',
    webhookSecretName: process.env.WEBHOOK_SECRET_NAME!,
    executeBusinessLogic,
    broadcastEvent,
  }),
};
```

**Your implementation targets**:

1. **`executeBusinessLogic.ts`** — Receives `BusinessLogicInterface`, parses `input.body`, applies
   business logic, returns a `ParsedInput` object with all typed fields populated.
2. **`broadcastEvent.ts`** — Exports the `ParsedInput` interface. Receives a `ParsedInput`, reads
   pre-computed typed fields, conditionally calls `publishCloudEvent`.

The factory (in the layer) handles: HMAC validation, event routing, error catching, structured
logging, and trace context propagation. Do not re-implement any of that.

### Handler export

**CRITICAL**: `sqs-lambda` and `api-gateway` handlers must use CommonJS export for ADOT compatibility:

```typescript
// CORRECT
module.exports = { handler: createSQSHandler(...) };

// WRONG — do not use
export const handler = ...;
export { handler };
```

### `step-function-handler` — direct export

Step Function handlers do **not** use the factory. They are plain TypeScript files:

```typescript
// handlers/assembleContext.ts
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

export const handler = async (event: HandlerInput): Promise<HandlerOutput> => {
  // Read from event state, do work, return updated state
  // Step Functions uses the return value as the next step's input
};
```

Key rules for Step Function handlers:
- Use ES module named export: `export const handler = async ...`
- Return the full output state — Step Functions chains on the return value
- Use `@aws-sdk/*` directly (available in Lambda runtime)
- Do **not** import from `@glennsbuilds/pm-lambda-layer-utils`
- Do **not** use `module.exports`

---

## Utilities

### `sqs-lambda` and `api-gateway`

Import shared utilities from `@glennsbuilds/pm-lambda-layer-utils`:

```typescript
import { publishCloudEvent, BusinessLogicInterface } from '@glennsbuilds/pm-lambda-layer-utils';
```

Available exports:
- `BusinessLogicInterface` — base input type (`body`, `traceCarrier`, `requestId`)
- `publishCloudEvent(eventBusName, { source, type, data, traceCarrier?, requestId? })` — CloudEvents publisher
- `HttpError` — typed HTTP error with `statusCode`
- `createSQSHandler` — SQS handler factory
- `createAPIGatewayWebhookHandler` — API Gateway webhook handler factory

Do **not** inline a `utils.ts` with a `publishCloudEvent` implementation. Use the layer.

### `step-function-handler`

Use `@aws-sdk/*` directly. No layer import. No shared utility — each step handler is self-contained.

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
