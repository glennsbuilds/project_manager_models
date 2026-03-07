import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

const PROJECT = "project-manager";

export class ProjectManagerBaseInfraStack extends cdk.Stack {
  public readonly eventBus: events.EventBus;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- EventBridge ---
    this.eventBus = new events.EventBus(this, "EventBus", {
      eventBusName: `${PROJECT}-event-bus`,
    });

    // --- DynamoDB single table ---
    this.table = new dynamodb.Table(this, "Table", {
      tableName: `${PROJECT}-table`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // GSI1: External source + ID lookup (used to find Conversations by GitHub node_id)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI2: External identity lookup (used to find Actors by GitHub login)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
    });

    // --- SSM Parameters for resource discovery ---
    new ssm.StringParameter(this, "EventBusNameParam", {
      parameterName: `/${PROJECT}/event-bus-name`,
      stringValue: this.eventBus.eventBusName,
      description: "Name of the shared EventBridge event bus",
    });

    new ssm.StringParameter(this, "EventBusArnParam", {
      parameterName: `/${PROJECT}/event-bus-arn`,
      stringValue: this.eventBus.eventBusArn,
      description: "ARN of the shared EventBridge event bus",
    });

    new ssm.StringParameter(this, "TableNameParam", {
      parameterName: `/${PROJECT}/dynamodb-table-name`,
      stringValue: this.table.tableName,
      description: "Name of the shared DynamoDB table",
    });

    new ssm.StringParameter(this, "TableArnParam", {
      parameterName: `/${PROJECT}/dynamodb-table-arn`,
      stringValue: this.table.tableArn,
      description: "ARN of the shared DynamoDB table",
    });

    // --- Tags ---
    cdk.Tags.of(this).add("project", PROJECT);
    cdk.Tags.of(this).add("environment", "production");

    // --- Outputs ---
    new cdk.CfnOutput(this, "EventBusName", {
      value: this.eventBus.eventBusName,
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });
  }
}
