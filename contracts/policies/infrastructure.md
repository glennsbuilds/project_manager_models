# Infrastructure Policy (Simplified)

## Cloud Provider
- **AWS** (sole provider)

## Compute
- **Lambda** with **Node.js 22.x** runtime
- Minimum memory/timeout for workload
- No long-running compute (EC2, ECS, Fargate) without exception

## Lambda Layer Support
- All Lambda functions include the **handlers layer** (`@internal/pm-lambda-layer-utils`)
- Layer provides: CloudEvents publishing, types, error handling
- Built automatically during `init.sh` execution

## API Layer
- **API Gateway (HTTP API)** for HTTPS endpoints
- All responses: Structured JSON
- No secrets/tokens in responses or headers

## Shared Base Infrastructure
Reference shared resources via SSM Parameter Store:

| Resource | Parameter |
|----------|-----------|
| EventBridge bus | `/project-manager/event-bus-name`, `/project-manager/event-bus-arn` |
| DynamoDB table | `/project-manager/dynamodb-table-name`, `/project-manager/dynamodb-table-arn` |

**Do not create** your own event buses or DynamoDB tables.

## Environment Model
- **Single production environment** (no dev/staging)
- Isolation via: EventBridge rule filtering, DynamoDB partition keys, CloudEvents metadata
- All resources tagged: `project: project-manager`, `environment: production`

## Messaging
- **EventBridge** (project-scoped bus only)
- **CloudEvents v1.0** structured JSON envelope
- Source format: `project-manager.<service-name>`
- Type format: `<entity>.<action>`

## Data Storage
- **DynamoDB** single table (shared across all services)
- **On-demand billing**
- **Point-in-time recovery** enabled
- Single-table design patterns preferred

## Secrets Management
- **AWS Secrets Manager**
- **NEVER** store secrets in Lambda environment variables
- Environment variable stores only **secret name/ARN**
- Lambda reads secret at runtime and caches it for the execution environment

## Infrastructure as Code
- **AWS CDK v2** (TypeScript only)
- All infrastructure defined in CDK stacks
- Review `cdk diff` before deploying

### CDK Stack Structure
- **Do not modify** generated `stack.ts` after creation
- **All custom infrastructure** goes in `addAdditionalInfra()` (called by all stacks)
- Available props:
  - API Gateway lambdas: `lambda`, `httpApi`, `lambdaIntegration`
  - SQS lambdas: `lambda`, `queue`, `deadLetterQueue`

### API Gateway Endpoint Setup (API Gateway Lambdas Only)
- **MUST** update `configureEndpoint()` in `infra/configure_endpoint.ts`
- Set `ENDPOINT_NAME` to a meaningful value
- Configure all routes and methods there (not in `stack.ts`)

## Versioned Deployments
- New versions are **separate CDK stacks** with version suffixes (V1Stack, V2Stack)
- V1 and V2 run simultaneously
- Shared infrastructure remains constant
- Decommission V1 only after V2 passes all contract tests

## Observability
- **OpenTelemetry** via **ADOT Lambda Layer**
- Framework handles: Span creation, trace context extraction/injection, logging format
- **CRITICAL**: Handlers must use `module.exports = { handler }` (CommonJS)
- **CRITICAL**: Every Lambda must include `collector.yaml` with OTEL configuration
- Set `OPENTELEMETRY_COLLECTOR_CONFIG_FILE=/var/task/collector.yaml`

## Cost Controls
- All resources: **Pay-per-use** (Lambda, EventBridge, DynamoDB on-demand, API Gateway)
- No fixed costs (NAT, ALBs, provisioned capacity)
- All resources tagged for cost allocation

## Multi-Region Readiness
- All region values **parameterized** in IaC (no hardcoding)
- Use DynamoDB Global Tables if multi-region needed later
cp