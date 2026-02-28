# Community Configuration

## Overview

Community configuration tracks which applications are installed in a community and at what version. It is owned exclusively by the **platform layer** — no application reads or writes these records directly.

This is the registry that the install, update, and marketplace mechanisms are built on.

---

## DynamoDB Key Patterns

Community configuration lives in the shared community DynamoDB table alongside application data. The platform layer owns the following key namespaces:

| PK | SK | Record type |
|----|----|-------------|
| `COMMUNITY#<community_id>` | `METADATA` | Community record |
| `COMMUNITY#<community_id>` | `APPLICATION#<app_name>` | Installed application record |

No application may write to keys beginning with `COMMUNITY#`.

---

## Primitives

### Community

Already defined in `contracts/domain/PRIMITIVES.md`. Stored at:
- `PK: COMMUNITY#<id>`, `SK: METADATA`

### InstalledApplication

Records that a specific application version is installed in a community, and tracks its current rollout state.

#### Fields

- `id`: GUID — unique record identifier
- `community_id`: GUID — the community this installation belongs to
- `application_name`: string — matches `name` in the application manifest
- `installed_version`: string — semantic version currently serving 100% of traffic
- `target_version`: string? — version being rolled out (null when no rollout in progress)
- `rollout_percentage`: integer (0–100) — percentage of traffic on `target_version` (0 when no rollout in progress)
- `status`: ENUM(`ACTIVE` | `INSTALLING` | `UPDATING` | `DISABLED`)
- `installed_at`: timestamp
- `updated_at`: timestamp

#### DynamoDB Key

- `PK: COMMUNITY#<community_id>`
- `SK: APPLICATION#<application_name>`

---

## Status Lifecycle

```
               install requested
                      │
                      ▼
                 INSTALLING ──── failure ──── (record removed)
                      │
                      │ complete
                      ▼
                   ACTIVE
                      │
              update requested
                      │
                      ▼
                  UPDATING ◄──── rollout_percentage increases over time
                      │
                      │ rollout_percentage reaches 100
                      ▼
              ACTIVE (new version)
                      │
                 admin disables
                      ▼
                  DISABLED
```

---

## Rollout Model

Updates use Lambda versions and aliases. When a community opts into a new version:

1. `status` → `UPDATING`, `target_version` set, `rollout_percentage` starts at 0
2. The deployment mechanism shifts Lambda alias weights incrementally
3. `rollout_percentage` is updated as traffic shifts
4. When `rollout_percentage` reaches 100: `installed_version` ← `target_version`, `target_version` ← null, `status` → `ACTIVE`

Rollback: set `target_version` back to `installed_version` and `rollout_percentage` to 0.

---

## Design Rules

- **Platform layer owns this data.** No application Lambda may write `COMMUNITY#` or `APPLICATION#` keys.
- **One record per application per community.** Installing the same application twice is an error.
- **Disabled ≠ uninstalled.** A `DISABLED` application retains its data. Uninstall is a separate explicit action (and data deletion is a separate, deliberate step).
- **Version history is not stored here.** The manifest registry (marketplace) tracks available versions. This table tracks only the currently installed state.
