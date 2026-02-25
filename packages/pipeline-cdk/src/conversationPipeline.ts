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
   * SSM path for SUMMARIZER_AGENT_ID. Defaults to "/project-manager/summarizer-agent-id".
   */
  readonly summarizerAgentIdSsmPath?: string;

  /**
   * SSM path for ARCHITECT_AGENT_ID. Defaults to "/project-manager/architect-agent-id".
   */
  readonly architectAgentIdSsmPath?: string;

}

export class ConversationPipelineConstruct extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly assembleContextFn: lambda.Function;
  public readonly summarizerAgentFn: lambda.Function;
  public readonly architectAgentFn: lambda.Function;
  public readonly persistCheckpointFn: lambda.Function;
  public readonly persistMessageFn: lambda.Function;
  public readonly emitCheckpointEventFn: lambda.Function;
  public readonly persistTasksFn: lambda.Function;
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
    const summarizerAgentIdParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.summarizerAgentIdSsmPath ?? "/project-manager/summarizer-agent-id",
    );
    const architectAgentIdParam = ssm.StringParameter.valueForStringParameter(
      this,
      props.architectAgentIdSsmPath ?? "/project-manager/architect-agent-id",
    );

    // --- Lambda functions ---

    // Prepares the conversation context for the AI agents. Absorbs the logic originally planned for the conversation assembler service.
    this.assembleContextFn = new lambda.Function(this, "AssembleContextFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/assembleContext.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Distills the conversation into a structured analysis — request summary, goals, constraints, and open questions.
    this.summarizerAgentFn = new lambda.Function(this, "SummarizerAgentFunction", {
      runtime,
      memorySize,
      timeout: cdk.Duration.seconds(120),
      handler: "handlers/summarizerAgent.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        SUMMARIZER_AGENT_ID: summarizerAgentIdParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Evaluates the summarized conversation and makes a triage decision. Determines if there's enough information to begin work, or if the pipeline should go back to the user.
    this.architectAgentFn = new lambda.Function(this, "ArchitectAgentFunction", {
      runtime,
      memorySize,
      timeout: cdk.Duration.seconds(120),
      handler: "handlers/architectAgent.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
        ARCHITECT_AGENT_ID: architectAgentIdParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create a NEED_INFORMATION ConversationCheckpoint
    this.persistCheckpointFn = new lambda.Function(this, "PersistCheckpointFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/persistCheckpoint.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create a Message from the AI response
    this.persistMessageFn = new lambda.Function(this, "PersistMessageFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/persistMessage.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Publish checkpoint.created event to EventBridge
    this.emitCheckpointEventFn = new lambda.Function(this, "EmitCheckpointEventFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/emitCheckpointEvent.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create Task entities for each task instruction
    this.persistTasksFn = new lambda.Function(this, "PersistTasksFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/persistTasks.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Publish checkpoint.created and task.created events
    this.emitEventsFn = new lambda.Function(this, "EmitEventsFunction", {
      runtime,
      memorySize,
      timeout: timeout,
      handler: "handlers/emitEvents.handler",
      code: props.lambdaCode,
      layers: props.lambdaLayers,
      environment: {
        EVENT_BUS_NAME: eventBusNameParam,
        DYNAMODB_TABLE_NAME: dynamodbTableNameParam,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // --- State machine definition ---

    const failState = new sfn.Fail(this, "PipelineFailed", {
      error: "PipelineError",
      cause: "An unrecoverable error occurred in the pipeline",
    });

    // Branch: BranchNeedInformation
    const branchNeedInformationPersistCheckpointTask = new tasks.LambdaInvoke(this, "BranchNeedInformation-PersistCheckpoint", {
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

    const branchNeedInformationPersistMessageTask = new tasks.LambdaInvoke(this, "BranchNeedInformation-PersistMessage", {
      lambdaFunction: this.persistMessageFn,
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

    const branchNeedInformationEmitCheckpointEventTask = new tasks.LambdaInvoke(this, "BranchNeedInformation-EmitCheckpointEvent", {
      lambdaFunction: this.emitCheckpointEventFn,
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

    const branchNeedInformationSucceed = new sfn.Succeed(this, "BranchNeedInformationSucceed");

    const branchNeedInformationChain = branchNeedInformationPersistCheckpointTask
      .next(branchNeedInformationPersistMessageTask)
      .next(branchNeedInformationEmitCheckpointEventTask)
      .next(branchNeedInformationSucceed);

    // Branch: BranchBeginWork
    const branchBeginWorkPersistCheckpointTask = new tasks.LambdaInvoke(this, "BranchBeginWork-PersistCheckpoint", {
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

    const branchBeginWorkPersistTasksTask = new tasks.LambdaInvoke(this, "BranchBeginWork-PersistTasks", {
      lambdaFunction: this.persistTasksFn,
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

    const branchBeginWorkEmitEventsTask = new tasks.LambdaInvoke(this, "BranchBeginWork-EmitEvents", {
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

    const branchBeginWorkSucceed = new sfn.Succeed(this, "BranchBeginWorkSucceed");

    const branchBeginWorkChain = branchBeginWorkPersistCheckpointTask
      .next(branchBeginWorkPersistTasksTask)
      .next(branchBeginWorkEmitEventsTask)
      .next(branchBeginWorkSucceed);

    // Branch: BranchCloseConversation
    const branchCloseConversationPersistCheckpointTask = new tasks.LambdaInvoke(this, "BranchCloseConversation-PersistCheckpoint", {
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

    const branchCloseConversationPersistMessageTask = new tasks.LambdaInvoke(this, "BranchCloseConversation-PersistMessage", {
      lambdaFunction: this.persistMessageFn,
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

    const branchCloseConversationEmitCheckpointEventTask = new tasks.LambdaInvoke(this, "BranchCloseConversation-EmitCheckpointEvent", {
      lambdaFunction: this.emitCheckpointEventFn,
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

    const branchCloseConversationSucceed = new sfn.Succeed(this, "BranchCloseConversationSucceed");

    const branchCloseConversationChain = branchCloseConversationPersistCheckpointTask
      .next(branchCloseConversationPersistMessageTask)
      .next(branchCloseConversationEmitCheckpointEventTask)
      .next(branchCloseConversationSucceed);

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

    const summarizerAgentTask = new tasks.LambdaInvoke(this, "SummarizerAgent", {
      lambdaFunction: this.summarizerAgentFn,
      outputPath: "$.Payload",
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(5),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    const architectAgentTask = new tasks.LambdaInvoke(this, "ArchitectAgent", {
      lambdaFunction: this.architectAgentFn,
      outputPath: "$.Payload",
    })
      .addRetry({
        maxAttempts: 3,
        backoffRate: 2,
        interval: cdk.Duration.seconds(5),
      })
      .addCatch(failState, {
        resultPath: "$.error",
      });

    const routeOnDecisionChoice = new sfn.Choice(this, "RouteOnDecision")
      .when(
        sfn.Condition.stringEquals("$.ArchitectAgent.output.decision", "NEED_INFORMATION"),
        branchNeedInformationChain,
      )
      .when(
        sfn.Condition.stringEquals("$.ArchitectAgent.output.decision", "BEGIN_WORK"),
        branchBeginWorkChain,
      )
      .when(
        sfn.Condition.stringEquals("$.ArchitectAgent.output.decision", "CLOSE_CONVERSATION"),
        branchCloseConversationChain,
      )
      .otherwise(failState);

    const definition = assembleContextTask
      .next(summarizerAgentTask)
      .next(architectAgentTask)
      .next(routeOnDecisionChoice);

    // State machine
    const logGroup = new logs.LogGroup(this, "StateMachineLogGroup", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.stateMachine = new sfn.StateMachine(this, "ConversationPipeline", {
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

    props.dynamoTable.grantReadWriteData(this.summarizerAgentFn);
    props.eventBus.grantPutEventsTo(this.summarizerAgentFn);
    this.summarizerAgentFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeAgent"],
        resources: ["*"],
      }),
    );

    props.dynamoTable.grantReadWriteData(this.architectAgentFn);
    props.eventBus.grantPutEventsTo(this.architectAgentFn);
    this.architectAgentFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeAgent"],
        resources: ["*"],
      }),
    );

    props.dynamoTable.grantReadWriteData(this.persistCheckpointFn);
    props.eventBus.grantPutEventsTo(this.persistCheckpointFn);

    props.dynamoTable.grantReadWriteData(this.persistMessageFn);
    props.eventBus.grantPutEventsTo(this.persistMessageFn);

    props.dynamoTable.grantReadWriteData(this.emitCheckpointEventFn);
    props.eventBus.grantPutEventsTo(this.emitCheckpointEventFn);

    props.dynamoTable.grantReadWriteData(this.persistTasksFn);
    props.eventBus.grantPutEventsTo(this.persistTasksFn);

    props.dynamoTable.grantReadWriteData(this.emitEventsFn);
    props.eventBus.grantPutEventsTo(this.emitEventsFn);

  }
}
