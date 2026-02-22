import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';

const eventBridgeClient = new EventBridgeClient({});

export interface CloudEventOptions {
  source: string;
  type: string;
  data: unknown;
  traceCarrier?: Record<string, string>;
  requestId?: string;
}

export async function publishCloudEvent(
  eventBusName: string,
  options: CloudEventOptions
): Promise<string> {
  const cloudEvent = {
    specversion: '1.0',
    id: randomUUID(),
    source: options.source,
    type: options.type,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    traceparent: options.traceCarrier?.['traceparent'] ?? null,
    tracestate: options.traceCarrier?.['tracestate'] ?? null,
    data: options.data,
  };

  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: eventBusName,
      Source: cloudEvent.source,
      DetailType: cloudEvent.type,
      Detail: JSON.stringify(cloudEvent),
    }],
  }));

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    operation: 'publishCloudEvent',
    status: 'success',
    request_id: options.requestId,
    event_id: cloudEvent.id,
    event_type: cloudEvent.type,
  }));

  return cloudEvent.id;
}
