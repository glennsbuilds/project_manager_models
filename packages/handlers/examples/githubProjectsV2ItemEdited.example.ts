/**
 * Example: GitHub Projects V2 Item Edited Webhook Handler
 *
 * Handles GitHub webhooks from Projects V2 when an item (issue/PR) is edited.
 * Demonstrates signature verification and change tracking.
 */

import { GitHubWebhookHandler, ProjectsV2ItemEditedPayloadSchema } from "../src/index.ts";
import type { ProjectsV2ItemEditedPayload } from "../src/index.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamoDB = new DynamoDBClient({});

export class ProjectsV2ItemEditedHandler
  extends GitHubWebhookHandler<ProjectsV2ItemEditedPayload>
{
  // GitHub sends this in X-GitHub-Event header
  webhookEvent = "projects_v2_item";

  // GitHub sends this in the action field of the payload
  webhookAction = "edited";

  async process(payload: ProjectsV2ItemEditedPayload): Promise<void> {
    // Optional: Validate payload against schema at runtime
    // const validated = this.validate(ProjectsV2ItemEditedPayloadSchema, payload);

    const projectId = payload.projects_v2.id;
    const projectTitle = payload.projects_v2.title;
    const changedBy = payload.sender.login;
    const changes = payload.changes || {};

    console.log(
      `📝 Project "${projectTitle}" edited by ${changedBy}`,
      JSON.stringify(changes, null, 2)
    );

    // 1. Persist the webhook event to DynamoDB for audit trail
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.WEBHOOKS_TABLE!,
        Item: {
          pk: `PROJECT#${projectId}`,
          sk: `EDITED#${new Date().toISOString()}#${payload.sender.id}`,
          webhookEvent: "projects_v2_item.edited",
          projectId,
          projectTitle,
          changedBy,
          changes,
          changedFields: Object.keys(changes),
          timestamp: new Date().toISOString(),
        },
      })
    );

    // 2. If title changed, update project index
    if (changes.title) {
      const { from, to } = changes.title as { from: string; to: string };
      console.log(`  Title: "${from}" → "${to}"`);

      await dynamoDB.send(
        new PutCommand({
          TableName: process.env.PROJECTS_TABLE!,
          Item: {
            pk: `PROJECT#${projectId}`,
            sk: "METADATA",
            id: projectId,
            title: to,
            updatedAt: new Date().toISOString(),
          },
        })
      );
    }

    // 3. Track who's actively editing projects (for activity feed)
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.ACTIVITY_TABLE!,
        Item: {
          pk: `USER#${payload.sender.id}`,
          sk: `ACTIVITY#${new Date().toISOString()}`,
          actor: payload.sender.login,
          actorId: payload.sender.id,
          action: "edited_project_item",
          projectId,
          projectTitle,
          resourceUrl: payload.projects_v2.html_url || null,
        },
      })
    );

    console.log(`✓ Processed webhook for project ${projectTitle}`);
  }
}

/**
 * Lambda handler
 *
 * Environment variables required:
 * - GITHUB_WEBHOOK_SECRET: The webhook secret configured in GitHub
 * - WEBHOOKS_TABLE: DynamoDB table for audit trail
 * - PROJECTS_TABLE: DynamoDB table for project data
 * - ACTIVITY_TABLE: DynamoDB table for activity feed
 */
const handler = new ProjectsV2ItemEditedHandler(
  process.env.GITHUB_WEBHOOK_SECRET!
);

export const lambdaHandler = (event: any) => handler.handle(event);

/**
 * Example webhook payload:
 *
 * {
 *   "action": "edited",
 *   "projects_v2": {
 *     "id": 20726245,
 *     "title": "project_manager",
 *     ...
 *   },
 *   "changes": {
 *     "title": {
 *       "from": "@glennsbuilds's untitled project",
 *       "to": "project_manager"
 *     }
 *   },
 *   "sender": {
 *     "login": "melodysdad",
 *     "id": 141704331,
 *     ...
 *   }
 * }
 */
