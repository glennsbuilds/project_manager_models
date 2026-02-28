# Infrastructure Policy

## Architect Agent: Read This First

This policy defines what you are allowed to build. If a user request cannot be satisfied using only the approved patterns and services listed here, **do not improvise**. Instead:

1. Tell the user what the constraint is
2. Explain what the approved alternative is (if one exists)
3. If no approved alternative exists, ask the user to reconsider the requirement or explicitly approve an infrastructure exception

**Never** introduce an AWS service not on the approved list to solve a problem. The cost, operational burden, and security surface area of unapproved services are unknown and unreviewed.

---

## Approved AWS Services

Only the following services may be used without explicit approval:

| Service | Approved use |
|---------|-------------|
| **Lambda** (Node.js 22.x) | All compute |
| **Step Functions** (Standard) | Orchestration of multi-step or long-running work |
| **DynamoDB** | All persistent data storage |
| **EventBridge** | All async messaging between services |
| **SQS** | Buffering between EventBridge and Lambda; decoupling producers from consumers |
| **API Gateway (HTTP API)** | HTTPS endpoints |
| **S3** | Large file and artifact storage only — not for structured data |
| **Secrets Manager** | Credentials and tokens |
| **SSM Parameter Store** | Configuration, resource references, feature flags |
| **Bedrock (Converse API)** | AI model invocation via Step Functions direct integration |
| **CloudWatch Logs** | Observability (automatic via ADOT) |

Everything else — EC2, ECS, Fargate, RDS, Elasticache, Kinesis, SNS, AppSync, and all other AWS services — requires an explicit infrastructure exception approved by the human. Do not use them without that approval.

---

## Compute

**Lambda is the only approved compute runtime.** All application logic runs in Lambda functions with Node.js 22.x.

### Lambda constraints
- Maximum execution time: **15 minutes**
- Maximum memory: **10 GB**
- No persistent local state between invocations

### When Lambda won't work

If a task exceeds Lambda's 15-minute timeout, the approved pattern is to **break the work into steps using Step Functions**. Each step is a Lambda invocation. Step Functions orchestrates the sequence, handles retries, and maintains state between steps.

Do not reach for ECS or EC2 to handle long-running work. If the work cannot be decomposed into steps that each complete within 15 minutes, that is a signal to reconsider the design — raise it with the user before proceeding.

### Scheduled work

Use **EventBridge Scheduler** to trigger a Lambda or Step Function on a schedule. Do not use cron jobs, EC2-based schedulers, or any other mechanism.

---

## Data Storage

### Structured data → DynamoDB
- Single shared table per community (referenced via SSM)
- On-demand billing, point-in-time recovery enabled
- Single-table design: all entities in one table, partitioned by `PK`/`SK` key patterns
- **Do not create new DynamoDB tables** — all data goes in the community table under the application's declared key namespace

### Large files and artifacts → S3
- Use S3 for generated code, documents, build artifacts, or any payload too large for DynamoDB (>400 KB per item)
- Store a reference (S3 key) in DynamoDB, not the content itself
- S3 bucket names must be referenced via SSM — do not hardcode

### What not to use
- **No RDS, Aurora, or relational databases** — the data model uses DynamoDB exclusively
- **No Elasticache** — caching is done in Lambda memory across warm invocations
- **No DynamoDB Streams** — use EventBridge events for change notification

---

## Messaging

- **EventBridge** is the only approved pub/sub mechanism between services
- **SQS** is approved as a buffer between EventBridge and Lambda (for retry, backpressure, and batching)
- All events use **CloudEvents v1.0** structured JSON format
- Source format: `project-manager.<service-name>`
- Type format: `project_manager.<entity>.<past-tense-action>`
- All defined event types are in `contracts/domain/TRANSITIONS.md` — do not invent new event types without defining them there first

**No SNS, Kinesis, or direct Lambda invocation** between services.

---

## Shared Base Infrastructure

Every community has a shared DynamoDB table and EventBridge bus. Reference them via SSM — never hardcode names or ARNs.

| Resource | SSM Parameter |
|----------|---------------|
| EventBridge bus name | `/project-manager/event-bus-name` |
| EventBridge bus ARN | `/project-manager/event-bus-arn` |
| DynamoDB table name | `/project-manager/dynamodb-table-name` |
| DynamoDB table ARN | `/project-manager/dynamodb-table-arn` |
| GitHub token secret name | `/project-manager/github-token-secret-name` |

**Do not create** your own event buses or DynamoDB tables.

---

## Secrets Management

- **Secrets Manager** for all credentials and tokens
- **Never** store secret values in Lambda environment variables
- Environment variables store only the secret **name** (not ARN, not value)
- Lambda retrieves the secret at runtime and caches it for the execution environment lifetime

---

## API Layer

- **API Gateway (HTTP API)** for all HTTPS endpoints — not REST API, not ALB
- All responses: structured JSON
- No secrets, tokens, or internal IDs in response headers

---

## Infrastructure as Code

- **AWS CDK v2** (TypeScript) for all infrastructure
- All infrastructure defined in CDK stacks — no ClickOps, no manual console changes
- Run `cdk diff` and review before deploying

### CDK Stack Structure
- New service versions are separate CDK stacks with version suffixes (`V1Stack`, `V2Stack`)
- V1 and V2 run simultaneously during rollout
- Decommission V1 only after V2 passes all contract tests

---

## Cost Controls

All approved services are pay-per-use. No fixed-cost infrastructure is permitted:

- No NAT Gateways
- No Application Load Balancers
- No provisioned DynamoDB capacity
- No reserved Lambda concurrency (unless explicitly approved)

All resources must be tagged: `project: project-manager`, `environment: production`

---

## Observability

- **OpenTelemetry** via **ADOT Lambda Layer** — included automatically in all Lambda functions
- Structured JSON logging to stdout for all log statements
- **CRITICAL**: Lambda handlers must export via `module.exports = { handler }` (CommonJS) for ADOT compatibility
- **CRITICAL**: Every Lambda bundle must include `collector.yaml`

---

## Multi-Region

- All region and account values parameterized — no hardcoding
- Do not design for multi-region unless explicitly requested
