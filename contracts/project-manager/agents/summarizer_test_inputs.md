# Summarizer Agent Test Inputs

These are realistic `assembled_message` payloads that simulate what AssembleContext
would produce. Paste each into the `{assembled_message}` placeholder in the user turn.

---

## Test Case 1: New Conversation — Feature Request (no approval)

Expected: PENDING approval, clear intent, mix of stated/implied requirements, open questions.

```
Conversation: conv-a1b2c3d4
Started: 2026-02-20T14:32:00Z

--- Message 1 ---
Author: sarah-chen
Timestamp: 2026-02-20T14:32:00Z

We need to add rate limiting to the public API. Right now there's nothing stopping
a single client from hammering our endpoints and degrading service for everyone else.

I'm thinking something like 100 requests per minute per API key, with a 429 response
when they go over. We should also return Retry-After headers so well-behaved clients
can back off automatically.

We're on API Gateway + Lambda if that matters.

--- Message 2 ---
Author: david-park
Timestamp: 2026-02-20T15:10:00Z

Makes sense. Should we also have different tiers? Enterprise customers probably need
higher limits than free-tier users.

--- Message 3 ---
Author: sarah-chen
Timestamp: 2026-02-20T15:45:00Z

Good point. Let's start with a single default limit and make it configurable per API
key later. I don't want to block on designing a full tier system.

--- Message 4 ---
Author: marcus-wright
Timestamp: 2026-02-21T09:15:00Z

FYI — API Gateway has built-in usage plans and throttling. We might not need custom
Lambda logic for this. Worth investigating before we build something from scratch.
```

---

## Test Case 2: New Conversation — Bug Report (no approval)

Expected: PENDING approval, bug-focused intent, minimal implied requirements, open questions about reproduction.

```
Conversation: conv-e5f6g7h8
Started: 2026-02-23T08:00:00Z

--- Message 1 ---
Author: jenny-liu
Timestamp: 2026-02-23T08:00:00Z

Users are reporting that the dashboard intermittently shows stale data after they
update a project. They click save, get the success toast, but the project list still
shows the old values. A hard refresh fixes it.

This started after last Thursday's deploy (v2.14.0). Before that it was fine.

--- Message 2 ---
Author: alex-rivera
Timestamp: 2026-02-23T09:20:00Z

I can reproduce this locally about 1 in 3 times. It looks like the query cache isn't
being invalidated after the mutation. We're using React Query — the mutation's
onSuccess should be calling queryClient.invalidateQueries but I haven't confirmed
whether it actually is.

--- Message 3 ---
Author: jenny-liu
Timestamp: 2026-02-23T10:05:00Z

Could this be related to the React Query v5 upgrade we did in that same release?
I remember there were some breaking changes around cache invalidation.
```

---

## Test Case 3: Continuation — Prior Summary + New Messages (with approval)

Expected: APPROVED status, synthesized summary that incorporates both the prior context and new approval message.

```
Conversation: conv-i9j0k1l2
Started: 2026-02-18T11:00:00Z

--- Prior Summary (from checkpoint chk-x1y2z3) ---

Core intent: The team wants to migrate the notification service from polling-based
delivery to a WebSocket-based push model to reduce latency and server load.

Key context: Current polling interval is 30 seconds, which users have complained
feels sluggish. The backend already uses API Gateway which supports WebSocket APIs.

Stated requirements:
- Real-time push notifications via WebSocket
- Graceful fallback to polling for clients that don't support WebSocket
- No changes to the notification data model

Open questions:
- How to handle reconnection logic on the client side
- Whether to use a managed service (e.g., AppSync) or raw API Gateway WebSocket API

--- New Messages ---

--- Message 5 ---
Author: priya-sharma
Timestamp: 2026-02-25T13:00:00Z

I looked into AppSync vs raw API Gateway WebSocket. AppSync adds a lot of GraphQL
overhead we don't need — our notifications are simple JSON pushes, not query results.
I'd recommend sticking with API Gateway WebSocket API directly.

For reconnection, I propose exponential backoff starting at 1 second, capped at
30 seconds. The client should also re-fetch missed notifications on reconnect via
the existing REST endpoint.

--- Message 6 ---
Author: sarah-chen
Timestamp: 2026-02-25T14:30:00Z

This looks good to me. The AppSync analysis is solid and the reconnection strategy
is exactly what I had in mind. Approved — let's move forward with this approach.
```

---

## Test Case 4: Edge Case — Vague Request

Expected: PENDING approval, broad intent, mostly inferred assumptions, several open questions.

```
Conversation: conv-m3n4o5p6
Started: 2026-02-26T10:00:00Z

--- Message 1 ---
Author: tom-baker
Timestamp: 2026-02-26T10:00:00Z

Can we make the app faster? Users are complaining.
```
