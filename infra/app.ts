import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  ConversationPipelineConstruct,
} from "../packages/pipeline-cdk/src/conversationPipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

const stack = new cdk.Stack(app, "ConversationPipelineStack", {
  env: { region: "us-east-1" },
  tags: {
    project: "project-manager",
    environment: "production",
  },
});

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

// Agent ID parameters — replace dummy values with real Bedrock agent IDs
new ssm.StringParameter(stack, "SummarizerAgentIdParam", {
  parameterName: "/project-manager/summarizer-agent-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock agent ID for the summarizer agent",
});

new ssm.StringParameter(stack, "ArchitectAgentIdParam", {
  parameterName: "/project-manager/architect-agent-id",
  stringValue: "PLACEHOLDER",
  description: "Bedrock agent ID for the architect agent",
});

new ConversationPipelineConstruct(stack, "ConversationPipeline", {
  dynamoTable: table,
  eventBus: bus,
  lambdaCode: lambda.Code.fromAsset(__dirname),
});
