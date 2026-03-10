import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  ConversationPipelineConstruct,
} from "../packages/pipeline-cdk/src/conversationPipeline";
import { ProjectManagerBaseInfraStack } from "./baseInfraStack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

const commonEnv = { region: "us-east-1" };
const commonTags = {
  project: "project-manager",
  environment: "production",
};

// Stack 0: Shared base infrastructure — EventBridge bus, DynamoDB table, and
// SSM parameters that all other stacks discover resources through.
new ProjectManagerBaseInfraStack(app, "ProjectManagerBaseInfra", {
  env: commonEnv,
  tags: commonTags,
});

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

new ssm.StringParameter(paramsStack, "RouterModelIdParam", {
  parameterName: "/project-manager/router-model-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock model ID for the router (e.g., qwen2.5-coder-32b-instruct-v1:0)",
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

const summarizerSystemPrompt = extractSystemPrompt(
  "../contracts/project-manager/agents/summarizer_prompt.txt",
);

// The router system prompt is a standalone classification prompt — it does not
// need the full platform context. Domain-specific planning is delegated to
// downstream services (e.g., the codeinator's architect agent for coding tasks).
const routerSystemPrompt = extractSystemPrompt(
  "../contracts/project-manager/agents/router_prompt.txt",
);

const sharedLambdaDir = path.join(__dirname, "../../project_manager_lambda/shared/lambda");

const utilsLayer = new lambda.LayerVersion(stack, "UtilsLayer", {
  code: lambda.Code.fromAsset(sharedLambdaDir, {
    bundling: {
      local: {
        tryBundle(outputDir: string): boolean {
          try {
            const nodeModulesOut = path.join(outputDir, "nodejs", "node_modules");
            fs.mkdirSync(nodeModulesOut, { recursive: true });
            for (const scope of ["@glennsbuilds", "@aws-sdk", "@aws", "@aws-crypto", "@smithy"]) {
              if (fs.existsSync(path.join(sharedLambdaDir, "node_modules", scope))) {
                execSync(`cp -r node_modules/${scope} "${nodeModulesOut}/"`, { cwd: sharedLambdaDir, stdio: "inherit" });
              }
            }
            return true;
          } catch {
            return false;
          }
        },
      },
      image: lambda.Runtime.NODEJS_22_X.bundlingImage,
      command: [
        "bash", "-c",
        [
          "cd /asset-input",
          "npm install --production",
          "mkdir -p /asset-output/nodejs/node_modules",
          "for scope in @glennsbuilds @aws-sdk @aws @aws-crypto @smithy; do [ -d node_modules/$scope ] && cp -r node_modules/$scope /asset-output/nodejs/node_modules/; done",
        ].join(" && "),
      ],
    },
  }),
  compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
  description: "Shared utilities for Project Manager Lambda functions",
});

const conversationPipeline = new ConversationPipelineConstruct(stack, "ConversationPipeline", {
  dynamoTable: table,
  eventBus: bus,
  lambdaCode: lambda.Code.fromAsset(__dirname),
  lambdaLayers: [utilsLayer],
  summarizerAgentSystemPrompt: summarizerSystemPrompt,
  routerAgentSystemPrompt: routerSystemPrompt,
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
