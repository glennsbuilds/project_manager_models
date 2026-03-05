const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

module.exports.handler = async (event) => {
  console.log("PersistTasks", JSON.stringify(event));

  const {
    conversation_id,
    checkpoint_id,
    actor_id,
    tasks = [],
  } = event;

  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    throw new Error('DYNAMODB_TABLE_NAME environment variable is not set');
  }

  const now = new Date().toISOString();
  const task_ids = [];

  for (const task of tasks) {
    const task_id = randomUUID();
    task_ids.push(task_id);

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TASK#${task_id}`,
        SK: 'METADATA',
        id: task_id,
        conversation_id,
        checkpoint_id: checkpoint_id ?? null,
        actor_id,
        type: task.type,
        templateType: task.templateType,
        triggerName: task.triggerName,
        webhookEvent: task.webhookEvent ?? '',
        webhookAction: task.webhookAction ?? '',
        behavioralContract: task.behavioralContract,
        parsedInputSpec: task.parsedInputSpec,
        samplePayloads: JSON.stringify(task.samplePayloads ?? []),
        status: 'PENDING',
        created_at: now,
        updated_at: now,
      },
    }));

    console.log(JSON.stringify({
      timestamp: now,
      level: 'info',
      operation: 'persistTask',
      task_id,
      conversation_id,
      type: task.type,
      templateType: task.templateType,
      triggerName: task.triggerName,
    }));
  }

  return { ...event, task_ids };
};
