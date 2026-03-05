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
    decision,
    checkpoint_summary,
    response_to_user,
    tasks = [],
    task_ids = [],
  } = event;

  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME environment variable is not set');
  }

  const now = new Date().toISOString();
  const entries = [];

  // Emit checkpoint.created (one event for the BEGIN_WORK decision)
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
        decision,
        response_to_user,
        checkpoint_summary,
      },
    }),
    EventBusName: eventBusName,
  });

  // Emit task.created for each persisted task
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const task_id = task_ids[i];

    if (!task_id) {
      console.warn(JSON.stringify({
        timestamp: now,
        level: 'warn',
        operation: 'emitEvents',
        message: `No task_id for task index ${i} — skipping task.created event`,
        conversation_id,
      }));
      continue;
    }

    entries.push({
      Source: 'project-manager.conversation-pipeline',
      DetailType: 'project_manager.task.created',
      Detail: JSON.stringify({
        specversion: '1.0',
        source: 'project-manager.conversation-pipeline',
        type: 'project_manager.task.created',
        time: now,
        datacontenttype: 'application/json',
        data: {
          task_id,
          conversation_id,
          actor_id,
          type: task.type,
          templateType: task.templateType,
          triggerName: task.triggerName,
          webhookEvent: task.webhookEvent ?? '',
          webhookAction: task.webhookAction ?? '',
          behavioralContract: task.behavioralContract,
          parsedInputSpec: task.parsedInputSpec,
          samplePayloads: task.samplePayloads ?? [],
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
    decision,
    checkpoint_event_count: 1,
    task_event_count: task_ids.filter(Boolean).length,
  }));

  return event;
};
