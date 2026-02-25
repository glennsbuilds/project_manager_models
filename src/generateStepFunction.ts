import {
  ParsedPipeline,
  StepDefinition,
  BranchDefinition,
  RetryConfig,
  EnvironmentVariable,
} from "./pipelineParser.ts";

/**
 * Generate a CDK construct file from a parsed pipeline definition.
 * Produces a self-contained TypeScript file with all CDK imports.
 */
export function generateStepFunction(pipeline: ParsedPipeline): string {
  const constructName = `${pipeline.metadata.name}Construct`;
  const propsName = `${pipeline.metadata.name}Props`;

  let output = generateHeader(pipeline);
  output += generateImports();
  output += generatePropsInterface(propsName, pipeline);
  output += generateConstructClass(constructName, propsName, pipeline);
  return output;
}

function generateHeader(pipeline: ParsedPipeline): string {
  return `// Auto-generated from contracts/services/conversation_pipeline.md
// Do not edit manually
//
// Pipeline: ${pipeline.metadata.name}
// Type: ${pipeline.metadata.type}
// Source: ${pipeline.metadata.source}

`;
}

function generateImports(): string {
  return `import * as cdk from "aws-cdk-lib";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

`;
}

function generatePropsInterface(
  propsName: string,
  pipeline: ParsedPipeline
): string {
  return `export interface ${propsName} {
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
   * Each step's handler is resolved as \`handlers/{stepName}.handler\`.
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
${generateSsmPropOverrides(pipeline.environment)}
}

`;
}

function generateSsmPropOverrides(env: EnvironmentVariable[]): string {
  const ssmVars = env.filter((e) => e.source === "ssm");
  if (ssmVars.length === 0) return "";

  let output = "\n  // SSM parameter path overrides (defaults shown)\n";
  for (const v of ssmVars) {
    const propName = camelCase(v.name) + "SsmPath";
    output += `\n  /**\n   * SSM path for ${v.name}. Defaults to "${v.parameter}".\n   */\n`;
    output += `  readonly ${propName}?: string;\n`;
  }
  return output;
}

function generateConstructClass(
  constructName: string,
  propsName: string,
  pipeline: ParsedPipeline
): string {
  let output = `export class ${constructName} extends Construct {\n`;
  output += `  public readonly stateMachine: sfn.StateMachine;\n`;

  // Expose Lambda functions so consumers can customize
  const lambdaSteps = collectAllLambdaSteps(pipeline);
  for (const step of lambdaSteps) {
    const propName = camelCase(step.name) + "Fn";
    output += `  public readonly ${propName}: lambda.Function;\n`;
  }

  output += `\n  constructor(scope: Construct, id: string, props: ${propsName}) {\n`;
  output += `    super(scope, id);\n\n`;
  output += `    const runtime = props.lambdaRuntime ?? lambda.Runtime.NODEJS_22_X;\n`;
  output += `    const memorySize = props.lambdaMemorySize ?? 256;\n`;
  output += `    const timeout = props.lambdaTimeout ?? cdk.Duration.seconds(30);\n\n`;

  // SSM lookups
  output += generateSsmLookups(pipeline.environment);

  // Lambda functions — deduplicated across main steps and branches
  output += generateLambdaFunctions(pipeline);

  // State machine definition
  output += generateStateMachineDefinition(pipeline);

  // IAM grants
  output += generateIamGrants(pipeline);

  output += `  }\n`;
  output += `}\n`;
  return output;
}

function generateSsmLookups(env: EnvironmentVariable[]): string {
  let output = "    // SSM parameter lookups\n";
  for (const v of env) {
    if (v.source === "ssm") {
      const varName = camelCase(v.name) + "Param";
      const overrideProp = camelCase(v.name) + "SsmPath";
      output += `    const ${varName} = ssm.StringParameter.valueForStringParameter(\n`;
      output += `      this,\n`;
      output += `      props.${overrideProp} ?? "${v.parameter}",\n`;
      output += `    );\n`;
    }
  }
  output += "\n";
  return output;
}

/**
 * Generate Lambda functions — one per unique step name.
 * Uses collectAllLambdaSteps to avoid duplicates when the same step name
 * appears in multiple branches (e.g., PersistCheckpoint).
 */
function generateLambdaFunctions(pipeline: ParsedPipeline): string {
  let output = "    // --- Lambda functions ---\n\n";

  const envBlock = generateEnvironmentBlock(pipeline.environment);
  const uniqueSteps = collectAllLambdaSteps(pipeline);

  for (const step of uniqueSteps) {
    output += generateLambdaForStep(step, envBlock, pipeline);
  }

  return output;
}

function generateLambdaForStep(
  step: StepDefinition,
  envBlock: string,
  pipeline: ParsedPipeline
): string {
  let output = "";
  const fnVarName = camelCase(step.name) + "Fn";
  const handlerPath = `handlers/${camelCase(step.name)}.handler`;

  output += `    // ${step.description?.trim().split("\n")[0] || step.name}\n`;
  output += `    this.${fnVarName} = new lambda.Function(this, "${step.name}Function", {\n`;
  output += `      runtime,\n`;
  output += `      memorySize,\n`;
  output += `      timeout: ${step.timeout_seconds ? `cdk.Duration.seconds(${step.timeout_seconds})` : "timeout"},\n`;
  output += `      handler: "${handlerPath}",\n`;
  output += `      code: props.lambdaCode,\n`;
  output += `      layers: props.lambdaLayers,\n`;
  output += `      environment: {\n`;
  output += envBlock;

  // Add agent-specific env var for BedrockAgentCore steps
  if (step.type === "BedrockAgentCore" && step.agent_id_env) {
    const envVar = pipeline.environment.find(
      (e) => e.name === step.agent_id_env
    );
    if (envVar) {
      const paramName = camelCase(envVar.name) + "Param";
      output += `        ${step.agent_id_env}: ${paramName},\n`;
    }
  }

  output += `      },\n`;
  output += `      tracing: lambda.Tracing.ACTIVE,\n`;
  output += `    });\n\n`;

  return output;
}

function generateEnvironmentBlock(env: EnvironmentVariable[]): string {
  let output = "";
  // Only include the common env vars (table name, event bus name)
  // Agent-specific vars are added per-step
  const commonVars = env.filter(
    (e) => e.name === "EVENT_BUS_NAME" || e.name === "DYNAMODB_TABLE_NAME"
  );
  for (const v of commonVars) {
    const paramName = camelCase(v.name) + "Param";
    output += `        ${v.name}: ${paramName},\n`;
  }
  return output;
}

function generateStateMachineDefinition(pipeline: ParsedPipeline): string {
  let output = "    // --- State machine definition ---\n\n";

  // Generate Fail state
  output += `    const failState = new sfn.Fail(this, "PipelineFailed", {\n`;
  output += `      error: "PipelineError",\n`;
  output += `      cause: "An unrecoverable error occurred in the pipeline",\n`;
  output += `    });\n\n`;

  // Generate branch definitions first (needed for Choice state)
  for (const branch of pipeline.branches) {
    output += generateBranchChain(branch, pipeline);
  }

  // Generate main step chain
  output += generateMainChain(pipeline);

  // Create the state machine
  output += `    // State machine\n`;
  output += `    const logGroup = new logs.LogGroup(this, "StateMachineLogGroup", {\n`;
  output += `      retention: logs.RetentionDays.TWO_WEEKS,\n`;
  output += `      removalPolicy: cdk.RemovalPolicy.DESTROY,\n`;
  output += `    });\n\n`;

  output += `    this.stateMachine = new sfn.StateMachine(this, "${pipeline.metadata.name}", {\n`;
  output += `      definitionBody: sfn.DefinitionBody.fromChainable(definition),\n`;
  output += `      stateMachineType: sfn.StateMachineType.${pipeline.metadata.type},\n`;
  output += `      tracingEnabled: true,\n`;
  output += `      logs: {\n`;
  output += `        destination: logGroup,\n`;
  output += `        level: sfn.LogLevel.ERROR,\n`;
  output += `      },\n`;
  output += `    });\n\n`;

  return output;
}

/**
 * Generate a branch's task states and chain them together.
 * Branch steps get prefixed with the branch name to avoid collisions
 * with identically-named steps in other branches.
 */
function generateBranchChain(
  branch: BranchDefinition,
  pipeline: ParsedPipeline
): string {
  let output = `    // Branch: ${branch.name}\n`;

  const taskSteps = branch.steps.filter(
    (s) => s.type !== "Succeed" && s.type !== "Placeholder"
  );
  const hasSucceed = branch.steps.some((s) => s.type === "Succeed");

  // Generate task states for this branch, prefixed with branch name
  for (const step of taskSteps) {
    output += generateBranchTaskState(step, branch.name, pipeline);
  }

  if (hasSucceed) {
    output += `    const ${camelCase(branch.name)}Succeed = new sfn.Succeed(this, "${branch.name}Succeed");\n\n`;
  }

  // Chain the branch steps
  const chainParts: string[] = [];
  for (const step of taskSteps) {
    chainParts.push(camelCase(branch.name) + pascalCase(step.name) + "Task");
  }
  if (hasSucceed) {
    chainParts.push(camelCase(branch.name) + "Succeed");
  }

  if (chainParts.length > 1) {
    output += `    const ${camelCase(branch.name)}Chain = ${chainParts[0]}\n`;
    for (let i = 1; i < chainParts.length; i++) {
      output += `      .next(${chainParts[i]})`;
      if (i < chainParts.length - 1) {
        output += "\n";
      }
    }
    output += `;\n\n`;
  } else if (chainParts.length === 1) {
    output += `    const ${camelCase(branch.name)}Chain = ${chainParts[0]};\n\n`;
  }

  return output;
}

/**
 * Generate a task state within a branch. The variable name and CDK construct ID
 * are prefixed with the branch name to avoid collisions.
 * The Lambda function reference is shared (no prefix needed for the function).
 */
function generateBranchTaskState(
  step: StepDefinition,
  branchName: string,
  pipeline: ParsedPipeline
): string {
  let output = "";
  // Prefixed variable name: branchNeedInformationPersistCheckpointTask
  const taskVarName = camelCase(branchName) + pascalCase(step.name) + "Task";
  // Prefixed CDK ID: BranchNeedInformation-PersistCheckpoint
  const cdkId = `${branchName}-${step.name}`;
  // Lambda function reference is shared (deduplicated)
  const fnVarName = camelCase(step.name) + "Fn";

  output += `    const ${taskVarName} = new tasks.LambdaInvoke(this, "${cdkId}", {\n`;
  output += `      lambdaFunction: this.${fnVarName},\n`;
  output += `      outputPath: "$.Payload",\n`;
  output += `    })`;

  // Add retry from the step definition or error_handling section
  const retry = step.retry || findErrorHandlingRetry(step.name, pipeline);
  if (retry) {
    output += `\n      .addRetry({\n`;
    output += `        maxAttempts: ${retry.max_attempts},\n`;
    output += `        backoffRate: ${retry.backoff_rate},\n`;
    output += `        interval: cdk.Duration.seconds(${retry.interval_seconds}),\n`;
    output += `      })`;
  }

  // Add catch -> fail
  output += `\n      .addCatch(failState, {\n`;
  output += `        resultPath: "$.error",\n`;
  output += `      });\n\n`;

  return output;
}

function generateMainChain(pipeline: ParsedPipeline): string {
  let output = "";
  const mainSteps = pipeline.steps;

  // Generate task states for non-Choice main steps
  for (const step of mainSteps) {
    if (step.type === "Choice") {
      output += generateChoiceState(step);
    } else if (step.type !== "Succeed" && step.type !== "Placeholder") {
      output += generateMainTaskState(step, pipeline);
    }
  }

  // Build the main chain
  const preChoiceSteps = [];
  let choiceStep: StepDefinition | null = null;

  for (const step of mainSteps) {
    if (step.type === "Choice") {
      choiceStep = step;
      break;
    }
    if (step.type !== "Succeed" && step.type !== "Placeholder") {
      preChoiceSteps.push(step);
    }
  }

  if (preChoiceSteps.length > 0) {
    output += `    const definition = ${camelCase(preChoiceSteps[0].name)}Task\n`;
    for (let i = 1; i < preChoiceSteps.length; i++) {
      output += `      .next(${camelCase(preChoiceSteps[i].name)}Task)\n`;
    }
    if (choiceStep) {
      output += `      .next(${camelCase(choiceStep.name)}Choice);\n\n`;
    } else {
      output = output.trimEnd() + ";\n\n";
    }
  }

  return output;
}

/**
 * Generate a task state for a main pipeline step (no branch prefix).
 */
function generateMainTaskState(
  step: StepDefinition,
  pipeline: ParsedPipeline
): string {
  let output = "";
  const taskVarName = camelCase(step.name) + "Task";
  const fnVarName = camelCase(step.name) + "Fn";

  output += `    const ${taskVarName} = new tasks.LambdaInvoke(this, "${step.name}", {\n`;
  output += `      lambdaFunction: this.${fnVarName},\n`;
  output += `      outputPath: "$.Payload",\n`;
  output += `    })`;

  // Add retry from the step definition or error_handling section
  const retry = step.retry || findErrorHandlingRetry(step.name, pipeline);
  if (retry) {
    output += `\n      .addRetry({\n`;
    output += `        maxAttempts: ${retry.max_attempts},\n`;
    output += `        backoffRate: ${retry.backoff_rate},\n`;
    output += `        interval: cdk.Duration.seconds(${retry.interval_seconds}),\n`;
    output += `      })`;
  }

  // Add catch -> fail
  output += `\n      .addCatch(failState, {\n`;
  output += `        resultPath: "$.error",\n`;
  output += `      });\n\n`;

  return output;
}

function generateChoiceState(step: StepDefinition): string {
  let output = "";
  const choiceVarName = camelCase(step.name) + "Choice";

  output += `    const ${choiceVarName} = new sfn.Choice(this, "${step.name}")\n`;

  if (step.branches) {
    for (const branch of step.branches) {
      const branchChainName = camelCase(branch.goto) + "Chain";
      output += `      .when(\n`;
      output += `        sfn.Condition.stringEquals("${step.input_field}", "${branch.match}"),\n`;
      output += `        ${branchChainName},\n`;
      output += `      )\n`;
    }
  }

  output += `      .otherwise(failState);\n\n`;

  return output;
}

function generateIamGrants(pipeline: ParsedPipeline): string {
  let output = "    // --- IAM grants ---\n\n";

  const lambdaSteps = collectAllLambdaSteps(pipeline);

  for (const step of lambdaSteps) {
    const fnVarName = camelCase(step.name) + "Fn";

    // All Lambda functions get DynamoDB and EventBridge access
    output += `    props.dynamoTable.grantReadWriteData(this.${fnVarName});\n`;
    output += `    props.eventBus.grantPutEventsTo(this.${fnVarName});\n`;

    // BedrockAgentCore steps get bedrock:InvokeAgent
    if (step.type === "BedrockAgentCore") {
      output += `    this.${fnVarName}.addToRolePolicy(\n`;
      output += `      new iam.PolicyStatement({\n`;
      output += `        actions: ["bedrock:InvokeAgent"],\n`;
      output += `        resources: ["*"],\n`;
      output += `      }),\n`;
      output += `    );\n`;
    }

    output += "\n";
  }

  return output;
}

// --- Helpers ---

/**
 * Collect all Lambda and BedrockAgentCore steps across main steps and branches,
 * deduplicated by step name. Steps with the same name share a Lambda function.
 */
function collectAllLambdaSteps(pipeline: ParsedPipeline): StepDefinition[] {
  const steps: StepDefinition[] = [];
  const seen = new Set<string>();

  const addStep = (step: StepDefinition) => {
    if (
      (step.type === "Lambda" || step.type === "BedrockAgentCore") &&
      !seen.has(step.name)
    ) {
      seen.add(step.name);
      steps.push(step);
    }
  };

  for (const step of pipeline.steps) {
    addStep(step);
  }
  for (const branch of pipeline.branches) {
    for (const step of branch.steps) {
      addStep(step);
    }
  }

  return steps;
}

/**
 * Find retry config from the error_handling section for a given step name.
 * Supports wildcard patterns like "*Persist*".
 */
function findErrorHandlingRetry(
  stepName: string,
  pipeline: ParsedPipeline
): RetryConfig | undefined {
  for (const rule of pipeline.error_handling) {
    if (rule.step === stepName) {
      return rule.retry;
    }
    // Wildcard matching: "*Persist*" matches "PersistCheckpoint"
    if (rule.step.includes("*")) {
      const pattern = rule.step.replace(/\*/g, ".*");
      if (new RegExp(`^${pattern}$`).test(stepName)) {
        return rule.retry;
      }
    }
  }
  return undefined;
}

/**
 * Convert PascalCase or UPPER_SNAKE_CASE to camelCase.
 */
function camelCase(str: string): string {
  // Handle UPPER_SNAKE_CASE (e.g., EVENT_BUS_NAME -> eventBusName)
  if (str.includes("_")) {
    return str
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  // Handle PascalCase (e.g., AssembleContext -> assembleContext)
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Ensure string is PascalCase (first letter uppercase).
 */
function pascalCase(str: string): string {
  if (str.includes("_")) {
    return str
      .toLowerCase()
      .replace(/(^|_)([a-z])/g, (_, _prefix, c) => c.toUpperCase());
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}
