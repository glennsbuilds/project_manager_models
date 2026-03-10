// Auto-generated from contracts/services/conversation_pipeline.md
// Do not edit manually
//
// Pipeline: ConversationPipeline
// Type: STANDARD
// Source: project-manager.conversation-pipeline

import * as cdk from "aws-cdk-lib";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface ConversationPipelineProps {
  /**
   * DynamoDB table for conversation, checkpoint, task, and message storage.
   */
  readonly dynamoTable: dynamodb.ITable;

  /**
   * EventBridge event bus for publishing domain events.
   */
  readonly eventBus: events.IEventBus;

  /**
   * Lambda code asset pointing to the handler source directory.
   * Each step's handler is resolved as `handlers/{stepName}.handler`.
   */
  readonly lambdaCode: lambda.Code;

  /**
   * Lambda runtime. Defaults to Node.js 22.x.
   */
  readonly lambdaRuntime?: lambda.Runtime;

  /**
   * Lambda memory size in MB. Defaults to 256.
   */
  readonly lambdaMemorySize?: number;

  /**
   * Lambda timeout. Defaults to 30 seconds.
   */
  readonly lambdaTimeout?: cdk.Duration;

  /**
   * Lambda layers to attach to all functions (e.g., shared utilities layer).
   */
  readonly lambdaLayers?: lambda.ILayerVersion[];

  // BedrockConverse system prompts

  /**
   * System prompt for the SummarizerAgent step (Bedrock Converse API).
   */
  readonly summarizerAgentSystemPrompt: string;

  /**
   * System prompt for the RouterAgent step (Bedrock Converse API).
   */
  readonly routerAgentSystemPrompt: string;

  // SSM parameter path overrides (defaults shown)

  /**
   * SSM path for EVENT_BUS_NAME. Defaults to "/project-manager/event-bus-name".
   */
  readonly eventBusNameSsmPath?: string;

  /**
   * SSM path for DYNAMODB_TABLE_NAME. Defaults to "/project-manager/dynamodb-table-name".
   */
  readonly dynamodbTableNameSsmPath?: string;

  /**
   * SSM path for SUMMARIZER_MODEL_ID. Defaults to "/project-manager/summarizer-model-id".
   */
  readonly summarizerModelIdSsmPath?: string;

  /**
   * SSM path for ROUTER_MODEL_ID. Defaults to "/project-manager/router-model-id".
   */
  readonly routerModelIdSsmPath?: string;

}

export class ConversationPipelineConstruct extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly assembleContextFn: lambda.Function;
  public readonly persistCheckpointFn: lambda.Function;
  public readonly persistMessageFn: lambda.Function;
  public readonly emitCheckpointEventFn: lambda.Function;
  public readonly emitEventsFn: lambda.Function;

  constructor(scope: Construct, id: string, props: ConversationPipelineProps) {
    super(scope, id);

    const runtime = props.lambdaRuntime ?? lambda.Runtime.NODEJS_22_X;
    const memorySize = props.lambdaMemorySize ?? 256;
    const timeout = props.lambdaTimeout ?? cdk.Duration.seconds(30);

    // SSM parameter lookups
    const eventBusNameParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.eventBusNameSsmPath ?? "/project-manager/event-bus-name",
    );
    const dynamodbTableNameParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.dynamodbTableNameSsmPath ?? "/project-manager/dynamodb-table-name",
    );
    const summarizerModelIdParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.summarizerModelIdSsmPath ?? "/project-manager/summarizer-model-id",
    );
    const routerModelIdParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.routerModelIdSsmPath ?? "/project-manager/router-model-id",
    );

    // --- OTEL / ADOT ---
    const adotLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ADOTLayer",
      `arn:aws:lambda:${cdk.Stack.of(this).region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-1:1`,
    );
    const otelEnv = {
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-handler",
      OPENTELEMETRY_COLLECTOR_CONFIG_FILE: "/var/task/collector.yaml",
    };
    const layers = [adotLayer, ...(props.lambdaLayers ?? [])];

    // --- Lambda functions ---

    // Prepares the conversation context for the AI agents. Absorbs the logic originally planned for the conversation assembler service.
    this.assembleContextFn = new lambda.Function(this, "AssembleContextFunction", {
      runtime,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: timeout,
      handler: "handlers/assembleContext.handler",
      code: props.lambdaCode,
      layers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ...otelEnv,
      },
    });

    // Create a NEED_INFORMATION ConversationCheckpoint
    this.persistCheckpointFn = new lambda.Function(this, "PersistCheckpointFunction", {
      runtime,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: timeout,
      handler: "handlers/persistCheckpoint.handler",
      code: props.lambdaCode,
      layers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ...otelEnv,
      },
    });

    // Create a Message from the AI response
    this.persistMessageFn = new lambda.Function(this, "PersistMessageFunction", {
      runtime,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: timeout,
      handler: "handlers/persistMessage.handler",
      code: props.lambdaCode,
      layers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ...otelEnv,
      },
    });

    // Publish checkpoint.created event to EventBridge
    this.emitCheckpointEventFn = new lambda.Function(this, "EmitCheckpointEventFunction", {
      runtime,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: timeout,
      handler: "handlers/emitCheckpointEvent.handler",
      code: props.lambdaCode,
      layers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ...otelEnv,
      },
    });

    // Publish checkpoint.created and task.routed events
    this.emitEventsFn = new lambda.Function(this, "EmitEventsFunction", {
      runtime,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: timeout,
      handler: "handlers/emitEvents.handler",
      code: props.lambdaCode,
      layers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ...otelEnv,
      },
    });

    // --- State machine definition ---

    const failState = new sfn.Fail(this, "PipelineFailed", {
      error: "PipelineError",
      cause: "An unrecoverable error occurred in the pipeline",
    });

    // After routing: persist checkpoint, emit task.routed event, succeed.
    // The router is a pure classifier — it always routes, never asks for info.
    // NEED_INFORMATION and CLOSE_CONVERSATION decisions are the responsibility
    // of downstream services (e.g., the architect agent in the codeinator).
    const persistCheckpointTask = new tasks.LambdaInvoke(this, "PersistCheckpoint", {
      lambdaFunction: this.persistCheckpointFn,
      outputPath: "$.Payload",
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(1),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    const emitEventsTask = new tasks.LambdaInvoke(this, "EmitEvents", {
      lambdaFunction: this.emitEventsFn,
      outputPath: "$.Payload",
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(1),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    const pipelineSucceed = new sfn.Succeed(this, "PipelineSucceed");

    const assembleContextTask = new tasks.LambdaInvoke(this, "AssembleContext", {
      lambdaFunction: this.assembleContextFn,
      outputPath: "$.Payload",
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(1),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    // Distills the conversation into a structured analysis — intent, requirements, assumptions, approval status, and open questions. See agents/summarizer.md for the full prompt contract. Invokes the model directly via the Bedrock Converse API — no Bedrock Agent required.
    // Step 1: Invoke model via Bedrock Converse API
    const summarizerAgentConverseTask = new tasks.CallAwsService(this, "SummarizerAgentConverse", {
      service: "bedrockruntime",
      action: "converse",
      parameters: {
        ModelId: summarizerModelIdParam,
        System: [{
          Text: props.summarizerAgentSystemPrompt,
        }],
        Messages: [{
          Role: "user",
          Content: [{
            Text: sfn.JsonPath.format(
              "Here is the assembled conversation data:\n\n{}\n\nSummarize the intent of this conversation.",
              sfn.JsonPath.stringAt("$.assembled_message"),
            ),
          }],
        }],
        InferenceConfig: {
          MaxTokens: 4096,
          Temperature: 0,
        },
      },
      iamResources: ["arn:aws:bedrock:*::foundation-model/*"],
      iamAction: "bedrock:InvokeModel",
      resultPath: "$.modelResponse",
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(120)),
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(5),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    // Step 2a: Parse model JSON response
    const summarizerAgentParseState = new sfn.Pass(this, "SummarizerAgentParse", {
      parameters: {
        "conversation_id.$": "$.conversation_id",
        "actor_id.$": "$.actor_id",
        "parsed.$": "States.StringToJson($.modelResponse.Output.Message.Content[0].Text)",
      },
    });

    // Step 2b: Extract fields from parsed response
    const summarizerAgentReshapeState = new sfn.Pass(this, "SummarizerAgentReshape", {
      parameters: {
        "conversation_id.$": "$.conversation_id",
        "actor_id.$": "$.actor_id",
        "summary.$": "$.parsed",
      },
    });

    // Classifies the task type for routing to downstream services.
    // Pure classifier — always routes, never asks for information or rejects.
    // See agents/router_prompt.txt for the full prompt contract.
    const routerAgentConverseTask = new tasks.CallAwsService(this, "RouterAgentConverse", {
      service: "bedrockruntime",
      action: "converse",
      parameters: {
        ModelId: routerModelIdParam,
        System: [{
          Text: props.routerAgentSystemPrompt,
        }],
        Messages: [{
          Role: "user",
          Content: [{
            Text: sfn.JsonPath.format(
              "Here is the conversation summary:\n\n{}\n\nClassify the task type.",
              sfn.JsonPath.stringAt("$.summary"),
            ),
          }],
        }],
        InferenceConfig: {
          MaxTokens: 4096,
          Temperature: 0,
        },
      },
      iamResources: ["arn:aws:bedrock:*::foundation-model/*"],
      iamAction: "bedrock:InvokeModel",
      resultPath: "$.modelResponse",
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(120)),
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(5),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    // Step 2a: Parse model JSON response — preserve summary for downstream routing
    const routerAgentParseState = new sfn.Pass(this, "RouterAgentParse", {
      parameters: {
        "conversation_id.$": "$.conversation_id",
        "actor_id.$": "$.actor_id",
        "summary.$": "$.summary",
        "parsed.$": "States.StringToJson($.modelResponse.Output.Message.Content[0].Text)",
      },
    });

    // Step 2b: Extract fields from parsed response
    const routerAgentReshapeState = new sfn.Pass(this, "RouterAgentReshape", {
      parameters: {
        "conversation_id.$": "$.conversation_id",
        "actor_id.$": "$.actor_id",
        "summary.$": "$.summary",
        "taskType.$": "$.parsed.taskType",
        "checkpoint_summary.$": "$.parsed.checkpoint_summary",
      },
    });

    const definition = assembleContextTask
      .next(summarizerAgentConverseTask)
      .next(summarizerAgentParseState)
      .next(summarizerAgentReshapeState)
      .next(routerAgentConverseTask)
      .next(routerAgentParseState)
      .next(routerAgentReshapeState)
      .next(persistCheckpointTask)
      .next(emitEventsTask)
      .next(pipelineSucceed);

    // State machine
    const logGroup = new logs.LogGroup(this, "StateMachineLogGroup", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.stateMachine = new sfn.StateMachine(this, "ConversationPipeline", {
      stateMachineName: "ConversationPipeline",
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
      },
    });

    // --- IAM grants ---

    props.dynamoTable.grantReadWriteData(this.assembleContextFn);
    props.eventBus.grantPutEventsTo(this.assembleContextFn);

    props.dynamoTable.grantReadWriteData(this.persistCheckpointFn);
    props.eventBus.grantPutEventsTo(this.persistCheckpointFn);

    props.dynamoTable.grantReadWriteData(this.persistMessageFn);
    props.eventBus.grantPutEventsTo(this.persistMessageFn);

    props.dynamoTable.grantReadWriteData(this.emitCheckpointEventFn);
    props.eventBus.grantPutEventsTo(this.emitCheckpointEventFn);

    props.dynamoTable.grantReadWriteData(this.emitEventsFn);
    props.eventBus.grantPutEventsTo(this.emitEventsFn);

    // --- State machine IAM grants (BedrockConverse) ---
    // CallAwsService creates these grants automatically via iamAction/iamResources.
    // Listed here for documentation — no additional code needed.

  }
}
