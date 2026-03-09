const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const client = new EventBridgeClient({});

const MAX_ENTRIES_PER_CALL = 10;

async function putEventsBatch(entries) {
  for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_CALL) {
    const batch = entries.slice(i, i + MAX_ENTRIES_PER_CALL);
    await client.send(new PutEventsCommand({ Entries: batch }));
  }
}

module.exports.handler = async (event) => {
  console.log("EmitEvents", JSON.stringify(event));

  const {
    conversation_id,
    actor_id,
    checkpoint_summary,
    taskType,
    summary,
  } = event;

  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME environment variable is not set');
  }

  const now = new Date().toISOString();
  const entries = [];

  // Emit checkpoint.created for the routing decision
  entries.push({
    Source: 'project-manager.conversation-pipeline',
    DetailType: 'project_manager.checkpoint.created',
    Detail: JSON.stringify({
      specversion: '1.0',
      source: 'project-manager.conversation-pipeline',
      type: 'project_manager.checkpoint.created',
      time: now,
      datacontenttype: 'application/json',
      data: {
        conversation_id,
        decision: 'BEGIN_WORK',
        checkpoint_summary,
      },
    }),
    EventBusName: eventBusName,
  });

  // Emit task.routed — downstream consumers filter on detail.data.taskType
  // (e.g., codeinator filters on taskType == "coding")
  if (taskType) {
    entries.push({
      Source: 'project-manager.conversation-pipeline',
      DetailType: 'project_manager.task.routed',
      Detail: JSON.stringify({
        specversion: '1.0',
        source: 'project-manager.conversation-pipeline',
        type: 'project_manager.task.routed',
        time: now,
        datacontenttype: 'application/json',
        data: {
          conversation_id,
          actor_id,
          taskType,
          summary,
        },
      }),
      EventBusName: eventBusName,
    });
  }

  await putEventsBatch(entries);

  console.log(JSON.stringify({
    timestamp: now,
    level: 'info',
    operation: 'emitEvents',
    status: 'published',
    conversation_id,
    taskType,
    checkpoint_event_count: 1,
    task_routed_event_count: taskType ? 1 : 0,
  }));

  return event;
};
