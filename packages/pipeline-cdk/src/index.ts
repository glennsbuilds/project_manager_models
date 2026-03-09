/**
 * @glennsbuilds/pm-pipeline-cdk
 *
 * Generated CDK constructs for project manager pipelines.
 * Auto-generated from contracts/services/ - do not edit manually.
 *
 * @example
 * ```typescript
 * import { ConversationPipelineConstruct } from '@glennsbuilds/pm-pipeline-cdk';
 *
 * const pipeline = new ConversationPipelineConstruct(this, 'ConversationPipeline', {
 *   dynamoTable: table,
 *   eventBus: bus,
 *   lambdaCode: lambda.Code.fromAsset('path/to/handlers'),
 * });
 *
 * // Grant the SQS consumer permission to start executions
 * pipeline.stateMachine.grantStartExecution(sqsConsumerLambda);
 * ```
 */

export * from "./conversationPipeline";
