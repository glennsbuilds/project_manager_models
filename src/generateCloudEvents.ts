import { TransitionDefinition } from "./transitionsParser.ts";

export function generateCloudEvents(transitions: TransitionDefinition[]): string {
  let output = `// Auto-generated from contracts/domain/TRANSITIONS.md
// Do not edit manually

import { z } from "zod";

/**
 * CloudEvents specification v1.0 envelope
 * See: https://cloudevents.io/
 */
export interface CloudEvent<T = unknown> {
  specversion: "1.0";
  type: string;
  source: string;
  id: string;
  time: string;
  datacontenttype?: "application/json";
  subject?: string;
  data?: T;
}

/**
 * CloudEvent validator using Zod
 */
export const CloudEventSchema = z.object({
  specversion: z.literal("1.0"),
  type: z.string(),
  source: z.string(),
  id: z.string().uuid(),
  time: z.string().datetime(),
  datacontenttype: z.literal("application/json").optional(),
  subject: z.string().optional(),
  data: z.unknown().optional(),
}).strict();

export type ValidatedCloudEvent = z.infer<typeof CloudEventSchema>;

/**
 * Validate a CloudEvent
 */
export function validateCloudEvent(event: unknown): event is ValidatedCloudEvent {
  try {
    CloudEventSchema.parse(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a CloudEvent envelope
 */
export function createCloudEvent<T>(
  type: string,
  source: string,
  data?: T,
  options?: {
    id?: string;
    time?: string;
    subject?: string;
  }
): CloudEvent<T> {
  return {
    specversion: "1.0",
    type,
    source,
    id: options?.id || crypto.randomUUID(),
    time: options?.time || new Date().toISOString(),
    subject: options?.subject,
    datacontenttype: data ? "application/json" : undefined,
    data,
  };
}

`;

  // Generate typed event creators for each transition
  for (const transition of transitions) {
    if (!transition.futureWork) {
      output += generateTransitionEventCreator(transition);
    }
  }

  return output;
}

function generateTransitionEventCreator(transition: TransitionDefinition): string {
  const eventType = transition.eventName;
  const source = "project_manager";
  const functionName = `create${transition.name}Event`;

  // Convert event name to camelCase function suffix
  // e.g., project_manager.conversation.started -> ConversationStartedEvent

  return `/**
 * Create a ${transition.name} event
 */
export function ${functionName}<T = unknown>(
  data?: T,
  options?: {
    id?: string;
    time?: string;
    subject?: string;
  }
): CloudEvent<T> {
  return createCloudEvent<T>(
    "${eventType}",
    "${source}",
    data,
    options
  );
}

`;
}
