# GitHub Webhook Lambda Handler Contract (Simplified)

## Overview
HTTPS Endpoint that receives GitHub `projects_v2_item` edited webhooks and emits events to EventBridge.

## Input
GitHub webhook POST for `projects_v2_item` with action `edited`.

Reference payloads: `samples/github_trigger/`

## Framework Handles Automatically
- ✅ HMAC-SHA256 signature validation (X-Hub-Signature-256 header)
- ✅ JSON parsing and error responses (400 for invalid JSON)
- ✅ HTTP status codes and response formatting
- ✅ Structured logging and error logging
- ✅ CloudEvents v1.0 envelope creation
- ✅ W3C Trace Context propagation
- ✅ Secret retrieval from AWS Secrets Manager (cached at cold start)

## Your Implementation

### 1. Payload Validation Schema
Create a Zod schema in `validateAndAuthorize.ts` that validates:
- `action` (should be "edited")
- `changes.field_value.field_type` (single_select, date, number, text, iteration)
- `changes.field_value.field_name` (e.g. "Status", "Priority")
- `changes.field_value.from` and `changes.field_value.to` (structures vary by field_type)
- `projects_v2_item.id` and `projects_v2_item.node_id`
- `sender.login`
- `organization.login` (optional)

**Important**: Use `.passthrough()` on objects to accept additional GitHub fields.

### 2. Business Logic: Conditional Event Filtering
In `executeBusinessLogic.ts`, implement the filtering condition:

**Only emit an event when BOTH conditions are true:**
1. `changes.field_value.field_name === "Status"`
2. `changes.field_value.to.name === "Ready"`

All other valid webhooks return 201 OK but do NOT emit events.

### 3. Event Data
When filtering conditions are met, populate the `data` field in `broadcastEvent.ts` with:
```json
{
  "type": "status_change",
  "field_name": "Status",
  "from_value": "In review",
  "to_value": "Ready",
  "item_node_id": "PVTI_lADODwOKGs4BMDMjzgjTx5g",
  "sender_login": "melodysdad",
  "organization_login": "glennsbuilds"
}
```

## Event Emitted

**Type**: `project_manager.message.added`
**Source**: `project-manager.github-trigger`
**When**: Status field changed to "Ready"
**Data**: Structured JSON (see above)

External identifiers are included; downstream services resolve to internal entities.

## Environment Variables
- `GITHUB_WEBHOOK_SECRET_NAME` — Secret name in AWS Secrets Manager
- `EVENT_BUS_NAME` — EventBridge bus for publishing

## Testing
- Unit tests in `src/*.test.ts` with >80% coverage
- Contract tests against real GitHub payloads in `samples/`

## Notes
- Framework handles all error cases (invalid signature returns 401, invalid JSON returns 400, processing errors return 500)
- Your job: validate schema, implement filtering logic, populate event data
- Duplicate webhooks from GitHub produce duplicate events; downstream consumers handle deduplication
