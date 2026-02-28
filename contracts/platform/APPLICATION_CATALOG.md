# Application Catalog

## Overview

This catalog is the authoritative registry of all available applications on the platform. It serves two purposes:

1. **Architect agent context** — before proposing to build something new, the architect should check this catalog to see if an existing application already covers the user's need, either fully or partially.
2. **Install mechanism** — the structured entries below are the source of truth for what a community can install.

## How to Use This Catalog (Architect Agent Instructions)

When a user requests new functionality:
- Check the `provides` field of each application to see if the capability already exists
- Check the `description` for intent match — a user asking for "task tracking" may be served by an existing application even if they didn't use that exact phrase
- If an existing application partially covers the need, surface that to the user before proposing new work
- If nothing matches, proceed with designing a new application per `contracts/platform/APPLICATION_MODEL.md`

---

## Applications

### project-tracker

```yaml
name: project-tracker
display_name: Project Tracker
latest_version: 1.0.0
status: active
description: >
  Manages projects and tasks for a community. Accepts work requests via GitHub
  issues linked to a GitHub Projects V2 board. Routes conversations through an
  AI pipeline (summarizer + architect agents) to triage intent, generate task
  instructions, and respond to the requester. Posts AI responses back to the
  originating GitHub issue and moves the project item status to "In Review".
provides:
  - conversational intake via GitHub Issues
  - AI-powered conversation triage and summarization
  - task generation from approved work requests
  - automated GitHub issue commenting
  - GitHub Projects V2 status management
requires:
  - GitHub repository with Projects V2 board
  - GitHub personal access token or app installation token
intake_mechanisms:
  - github-projects-v2
repository: project_manager_lambda + project_manager_models
manifest: contracts/platform/APPLICATION_MODEL.md
```

---

## Adding an Application

When a new application is ready to publish:

1. Add an entry to this file following the format above
2. Ensure the application has a manifest in its repository following `contracts/platform/APPLICATION_MODEL.md`
3. Set `status: active` only when the application is deployed and installable
4. Use `status: preview` for applications that are functional but not yet recommended for general use

## Status Values

| Status | Meaning |
|--------|---------|
| `active` | Stable, recommended for general use |
| `preview` | Functional but may change; early adopters only |
| `deprecated` | Being phased out; do not install in new communities |
| `inactive` | Not currently maintained |
