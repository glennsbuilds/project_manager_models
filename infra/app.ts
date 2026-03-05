import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
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

new ssm.StringParameter(paramsStack, "ArchitectModelIdParam", {
  parameterName: "/project-manager/architect-model-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock model ID for the architect (e.g., qwen2.5-coder-32b-instruct-v1:0)",
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

// Load system prompts from contract prompt files.
// Each file contains system and user sections separated by markers.
function extractSystemPrompt(filePath: string): string {
  const raw = fs.readFileSync(path.resolve(__dirname, filePath), "utf-8");
  const match = raw.match(
    /===== SYSTEM PROMPT =====\n([\s\S]*?)(?:\n===== USER TURN =====|$)/,
  );
  return match ? match[1].trim() : raw.trim();
}

function readContract(filePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, filePath), "utf-8").trim();
}

const summarizerSystemPrompt = extractSystemPrompt(
  "../contracts/agents/summarizer_prompt.txt",
);

// The architect system prompt is assembled from the base prompt + injected platform
// context. Documents are read at CDK synthesis time so every cdk deploy picks up
// the latest content without any manual sync.
const architectSystemPrompt = [
  extractSystemPrompt("../contracts/agents/architect_prompt.txt"),
  "",
  "---",
  "",
  "## Platform Context",
  "",
  "The following documents define the platform you are operating within.",
  "Read them in full before making any triage decision.",
  "",
  "---",
  "",
  readContract("../contracts/platform/ARCHITECTURE.md"),
  "",
  "---",
  "",
  readContract("../contracts/policies/infrastructure.md"),
  "",
  "---",
  "",
  readContract("../contracts/platform/CODE_GENERATION.md"),
  "",
  "---",
  "",
  readContract("../contracts/platform/APPLICATION_CATALOG.md"),
  "",
  "---",
  "",
  readContract("../contracts/domain/PRIMITIVES.md"),
  "",
  "---",
  "",
  readContract("../contracts/domain/TRANSITIONS.md"),
].join("\n");

const conversationPipeline = new ConversationPipelineConstruct(stack, "ConversationPipeline", {
  dynamoTable: table,
  eventBus: bus,
  lambdaCode: lambda.Code.fromAsset(__dirname),
  summarizerAgentSystemPrompt: summarizerSystemPrompt,
  architectAgentSystemPrompt: architectSystemPrompt,
});

// Trigger the Step Function when conversation_waiting is emitted
new events.Rule(stack, "ConversationWaitingRule", {
  eventBus: bus,
  eventPattern: {
    source: ["project-manager.github-event-processor"],
    detailType: ["project_manager.conversation_waiting"],
  },
  targets: [
    new targets.SfnStateMachine(conversationPipeline.stateMachine, {
      input: events.RuleTargetInput.fromObject({
        conversation_id: events.EventField.fromPath("$.detail.data.conversation_id"),
        actor_id: events.EventField.fromPath("$.detail.data.actor_id"),
        is_new: events.EventField.fromPath("$.detail.data.is_new"),
        content: events.EventField.fromPath("$.detail.data.content"),
      }),
    }),
  ],
});
