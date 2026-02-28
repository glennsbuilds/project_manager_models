# Platform MCP Server

## Overview

The Platform MCP Server is the **operational interface** for agents interacting with live community state. It exposes two categories of capability:

- **Resources** — read live community and application inventory state from DynamoDB
- **Tools** — trigger install, update, and lifecycle actions on installed applications

This server is the boundary between agents and the platform's operational data. Agents use it when they need to know or change the state of the world at runtime. Static reference material (contracts, policies, catalog) is injected as context — not served through this server.

**All writes go through this server.** No agent or service should write directly to `COMMUNITY#` or `APPLICATION#` DynamoDB keys. Those namespaces are owned by this server exclusively.

---

## When Agents Should Use This Server

| Agent need | How to satisfy it |
|------------|------------------|
| Understand the rules, policies, data model | Injected context (static docs) |
| Check what applications exist in the catalog | `APPLICATION_CATALOG.md` (injected context) |
| Check what is installed in a specific community | `community://{id}/applications` resource |
| Install an application into a community | `install_application` tool |
| Check install or rollout progress | `community://{id}/applications/{name}` resource |
| Begin a version rollout | `update_application` tool |
| Adjust rollout traffic percentage | `set_rollout_percentage` tool |
| Disable an installed application | `disable_application` tool |

---

## Resources

Resources provide read access to live community state. They are read-only — use tools to make changes.

### `community://{community_id}`

Returns metadata for a community.

**Response**
```json
{
  "id": "string",
  "name": "string",
  "description": "string | null",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

**Errors**
- `community_not_found` — no community with the given ID exists

---

### `community://{community_id}/applications`

Returns the list of all installed applications for a community, including their current status and version.

**Response**
```json
[
  {
    "application_name": "string",
    "display_name": "string",
    "installed_version": "string",
    "target_version": "string | null",
    "rollout_percentage": "integer",
    "status": "INSTALLING | ACTIVE | UPDATING | DISABLED",
    "installed_at": "timestamp",
    "updated_at": "timestamp"
  }
]
```

**Errors**
- `community_not_found`

---

### `community://{community_id}/applications/{application_name}`

Returns the full state of a single installed application.

**Response**
```json
{
  "id": "string",
  "community_id": "string",
  "application_name": "string",
  "display_name": "string",
  "installed_version": "string",
  "target_version": "string | null",
  "rollout_percentage": "integer",
  "status": "INSTALLING | ACTIVE | UPDATING | DISABLED",
  "installed_at": "timestamp",
  "updated_at": "timestamp"
}
```

**Errors**
- `community_not_found`
- `application_not_installed` — the application exists in the catalog but is not installed in this community

---

## Tools

Tools trigger state changes. Each tool validates its inputs, writes to DynamoDB, and where appropriate triggers a Step Function workflow for multi-step operations.

---

### `install_application`

Installs an application into a community. Creates an `InstalledApplication` record and triggers the install workflow Step Function, which handles CDK deployment and status updates.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `community_id` | string | yes | Target community |
| `application_name` | string | yes | Must match a `name` in APPLICATION_CATALOG.md |
| `version` | string | yes | Semantic version to install |

**Returns**
```json
{
  "id": "string",
  "community_id": "string",
  "application_name": "string",
  "installed_version": "string",
  "status": "INSTALLING",
  "installed_at": "timestamp"
}
```

**Errors**
- `community_not_found`
- `application_not_in_catalog` — the application_name does not exist in the catalog
- `version_not_found` — the requested version does not exist for this application
- `already_installed` — the application is already installed (status: ACTIVE or INSTALLING); use `update_application` to change version
- `install_in_progress` — another install is already in progress for this community

**Workflow**
1. Creates `InstalledApplication` record with `status: INSTALLING`
2. Triggers install Step Function
3. Step Function deploys CDK stack, verifies, updates record to `status: ACTIVE`
4. On failure: record is removed, Step Function emits failure event

---

### `update_application`

Begins a version rollout for an already-installed application. Sets `target_version` and initialises `rollout_percentage` to 0. Traffic shifting is managed by subsequent calls to `set_rollout_percentage`.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `community_id` | string | yes | Target community |
| `application_name` | string | yes | Must be currently installed and ACTIVE |
| `target_version` | string | yes | New version to roll out |

**Returns**
```json
{
  "community_id": "string",
  "application_name": "string",
  "installed_version": "string",
  "target_version": "string",
  "rollout_percentage": 0,
  "status": "UPDATING",
  "updated_at": "timestamp"
}
```

**Errors**
- `community_not_found`
- `application_not_installed`
- `application_not_active` — application must be ACTIVE to begin an update
- `version_not_found`
- `already_on_version` — target_version matches installed_version
- `rollout_in_progress` — a rollout is already in progress; complete or roll back first

---

### `set_rollout_percentage`

Adjusts the percentage of traffic directed to the `target_version` during an active rollout. When set to 100, completes the rollout: `installed_version` is updated to `target_version`, `target_version` is cleared, and `status` returns to `ACTIVE`.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `community_id` | string | yes | Target community |
| `application_name` | string | yes | Must be currently UPDATING |
| `percentage` | integer (0–100) | yes | New rollout percentage |

**Behaviour**
- `percentage: 0` — rolls back: clears `target_version`, resets `status` to `ACTIVE`
- `percentage: 1–99` — shifts traffic; updates Lambda alias weights
- `percentage: 100` — completes rollout: promotes `target_version` to `installed_version`

**Returns**
```json
{
  "community_id": "string",
  "application_name": "string",
  "installed_version": "string",
  "target_version": "string | null",
  "rollout_percentage": "integer",
  "status": "UPDATING | ACTIVE",
  "updated_at": "timestamp"
}
```

**Errors**
- `community_not_found`
- `application_not_installed`
- `no_rollout_in_progress` — application must be UPDATING to set rollout percentage

---

### `disable_application`

Disables an installed application. The application's infrastructure remains deployed and its data is preserved. Use this to suspend an application without losing community data.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `community_id` | string | yes | Target community |
| `application_name` | string | yes | Must be currently ACTIVE |

**Returns**
```json
{
  "community_id": "string",
  "application_name": "string",
  "status": "DISABLED",
  "updated_at": "timestamp"
}
```

**Errors**
- `community_not_found`
- `application_not_installed`
- `application_not_active` — can only disable ACTIVE applications; cannot disable while INSTALLING or UPDATING

---

## Error Format

All errors follow this shape:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": {}
}
```

---

## Implementation Notes

- The MCP server is a Lambda function fronted by an appropriate transport (stdio for local agent use, HTTP for remote)
- All DynamoDB writes use conditional expressions to prevent race conditions
- The install and update Step Functions are responsible for updating `status` to terminal states (`ACTIVE`, `DISABLED`); the MCP server only initiates transitions
- EventBridge events are emitted for all state transitions (defined in `contracts/domain/TRANSITIONS.md` — `ApplicationInstalled`, `ApplicationUpdated`, `ApplicationDisabled` to be added when this server is implemented)
- This server does not serve the document library — static contracts are injected as agent context directly
