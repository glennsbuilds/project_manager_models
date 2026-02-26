import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
  ConversationPipelineConstruct,
} from "../packages/pipeline-cdk/src/conversationPipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

const commonEnv = { region: "us-east-1" };
const commonTags = {
  project: "project-manager",
  environment: "production",
};

// Stack 1: SSM parameters — deployed first so they exist before the pipeline
// stack references them via CloudFormation dynamic references.
// Replace PLACEHOLDER values with real Bedrock agent IDs once they are known.
const paramsStack = new cdk.Stack(app, "ProjectManagerParamsStack", {
  env: commonEnv,
  tags: commonTags,
});

new ssm.StringParameter(paramsStack, "SummarizerModelIdParam", {
  parameterName: "/project-manager/summarizer-model-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock model ID for the summarizer (e.g., qwen2.5-coder-32b-instruct-v1:0)",
});

new ssm.StringParameter(paramsStack, "ArchitectAgentIdParam", {
  parameterName: "/project-manager/architect-agent-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock agent ID for the architect agent",
});

// Stack 2: Conversation pipeline — depends on paramsStack so CDK always
// deploys the parameters before this stack's changeset is created.
const stack = new cdk.Stack(app, "ConversationPipelineStack", {
  env: commonEnv,
  tags: commonTags,
});

stack.addDependency(paramsStack);

// Look up shared resources via SSM
const tableName = ssm.StringParameter.valueForStringParameter(
  stack,
  "/project-manager/dynamodb-table-name",
);
const table = dynamodb.Table.fromTableName(stack, "SharedTable", tableName);

const busName = ssm.StringParameter.valueForStringParameter(
  stack,
  "/project-manager/event-bus-name",
);
const bus = events.EventBus.fromEventBusName(stack, "SharedBus", busName);

// Load the summarizer system prompt from the contract prompt file.
// The file contains both system and user sections separated by markers —
// extract just the system prompt portion.
const summarizerPromptRaw = fs.readFileSync(
  path.resolve(__dirname, "../contracts/agents/summarizer_prompt.txt"),
  "utf-8",
);
const systemPromptMatch = summarizerPromptRaw.match(
  /===== SYSTEM PROMPT =====\n([\s\S]*?)(?:\n===== USER TURN =====|$)/,
);
const summarizerSystemPrompt = systemPromptMatch
  ? systemPromptMatch[1].trim()
  : summarizerPromptRaw.trim();

new ConversationPipelineConstruct(stack, "ConversationPipeline", {
  dynamoTable: table,
  eventBus: bus,
  lambdaCode: lambda.Code.fromAsset(__dirname),
  summarizerAgentSystemPrompt: summarizerSystemPrompt,
});
