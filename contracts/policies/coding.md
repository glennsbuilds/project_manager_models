# Coding Policy (Simplified)

## Code Lifecycle
- Application code is **disposable** — versioned deployments (V1, V2, etc.) are generated from scratch
- **Contracts**, **policies**, and **tests** are persisted in git
- When a service changes, create a new version and decommission the old one after passing contract tests

## Language & Runtime
- **TypeScript** (sole language) → **Node.js 22.x LTS**
- **npm** for package management

## Testing Requirements

### Unit Tests
- Framework: **Vitest**
- **Coverage must exceed 80%** (lines, branches, functions, statements)
- All business logic in `executeBusinessLogic()` must be tested

### Contract Tests
- Located in `test_suites/`
- Validate deployed service against contract
- **Contract tests are the authoritative measure of correctness**

### Deployment Success Criteria
1. Unit tests pass with >80% coverage
2. `cdk deploy` succeeds
3. All contract tests pass against deployed environment

## Handler Implementation Scope

Templates handle automatically:
- ✅ Input validation (HMAC for webhooks, schema for SQS)
- ✅ Error handling (try/catch, structured logging, HTTP responses)
- ✅ Logging (JSON format, timestamps, request IDs)
- ✅ Event publishing (CloudEvents, W3C Trace Context)

**Your scope**: Implement only:
1. **`executeBusinessLogic()`** — Core business work (data transformation, persistence, etc.)
2. **`data` field in `publishCloudEvent()`** — Event payload structure
3. **`validateAndAuthorize()`** — Schema validation (framework handles HMAC, signatures)
4. **Unit and contract tests**

## Template Pattern

All handlers use the same pipeline:

```
Framework →
  1. Validate input (HMAC, schema)
  2. Call executeBusinessLogic()
  3. Call publishCloudEvent()
  4. Handle errors & logging
  ← Framework
```

You only implement step 2 and 3.

## Handler Exports

**CRITICAL**: Use CommonJS export for ADOT compatibility:
```typescript
module.exports = { handler };
```
NOT: `export async function handler(...)`

## Observability

### OpenTelemetry (ADOT Layer)
- Framework handles span creation and W3C Trace Context extraction
- Your implementation: Add business-specific log statements if needed
- All logs: Structured JSON to stdout

### Structured Logging Format
```json
{
  "timestamp": "2026-02-14T12:00:00Z",
  "level": "info|warn|error",
  "operation": "operation_name",
  "status": "success|error",
  "request_id": "unique_id",
  // ... business fields
}
```

## Secrets Management

**NEVER** hardcode secrets. Use AWS Secrets Manager:
- Environment variable stores only the **secret name/ARN** (e.g., `SECRET_NAME=my-secret`)
- Lambda retrieves the actual secret at runtime
- For webhooks: Secret is cached at cold start to avoid repeated retrieval

## Testing Best Practices

- **Mock external services** (EventBridge, Secrets Manager) in unit tests
- **Use real payloads** from `samples/` in contract tests
- **Test business logic** in isolation from framework
- **Don't test** error handling, logging, or response formatting (framework handles)

## Dependency Injection

External clients (EventBridge, etc.) are provided by framework. Import from the layer:
```typescript
import { publishCloudEvent } from '@internal/pm-lambda-layer-utils';
```

No need to instantiate AWS SDK clients in your code.
