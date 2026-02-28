const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const client = new EventBridgeClient({});

module.exports.handler = async (event) => {
  console.log("EmitCheckpointEvent", JSON.stringify(event));

  const { conversation_id, response_to_user, decision } = event;
  const eventBusName = process.env.EVENT_BUS_NAME;

  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME environment variable is not set');
  }

  await client.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'project-manager.conversation-pipeline',
        DetailType: 'project_manager.checkpoint.created',
        Detail: JSON.stringify({
          specversion: '1.0',
          source: 'project-manager.conversation-pipeline',
          type: 'project_manager.checkpoint.created',
          time: new Date().toISOString(),
          datacontenttype: 'application/json',
          data: {
            conversation_id,
            response_to_user,
            decision,
          },
        }),
        EventBusName: eventBusName,
      },
    ],
  }));

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    operation: 'emitCheckpointEvent',
    status: 'published',
    conversation_id,
    decision,
  }));

  return event;
};
