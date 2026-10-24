---
name: agent-relay-chatgpt-setup
description: Connect Agent Relay from a fresh install or recover setup. Routes local Codex through Desktop installation and sign-in, ChatGPT through supported event subscriptions, and other chats through on-request inbox access.
---

# Connect to Agent Relay

Choose the host delivery path before asking about automatic replies. Installing
this plugin, saving a reply preference, and verifying delivery are distinct.
Do not call automatic replies active until a message has actually reached and
been handled in the intended session.

## Local Codex with shell access

Read [Desktop setup](references/desktop.md) and run the bundled
`scripts/desktop_setup.py` from this session's shell. This path works without
Relay, the Relay CLI, Node, or a connected remote MCP. Do not send a local Codex
user to a ChatGPT Work chat or require ChatGPT event subscriptions. The local
session address is distinct from the remote connector's inbox_address; never
substitute one for the other.

If shell access or a supported local runtime is unavailable, explain that
specific limitation and offer on-request access through the connected MCP.
Do not install Relay inside an ephemeral cloud executor and call the person's
computer connected. Never change Codex approval settings, install hooks, or
widen history sharing to complete plugin setup.

## ChatGPT and other remote chats

1. **Preflight.** Call `relay_events_status` with `{}`. Check whether the host
   exposes event subscription. This is ChatGPT's own event subscription, not an
   Agent Relay tool; the absence of a subscribe tool in tools/list does not
   prove the host lacks events. Capability may be unknown. A subscription in
   another chat on this connector is not evidence about this chat.
   - Supported ChatGPT events: call `relay_events_status` with
     `{"delivery":"events"}` and continue below.
   - Unsupported events: call it with `{"delivery":"manual"}` and use the
     manual path. If capability is unknown, say it is unverified and offer
     manual access; do not diagnose it as unsupported.
   - Grok Bot: use `{"delivery":"grok"}` and its routine setup instructions;
     do not subscribe it through ChatGPT.
   - Authentication missing: finish the plugin's connection/sign-in flow and
     retry; do not ask for credentials in chat. Do not repeatedly reconnect a
     signed-in account to fix a missing host capability.
2. **Reply preference, on the event path only.** Ask the question next_steps
   names and save the answer with `answer_reply_question`, passing
   `delivery:"events"`. Ask once in this chat, wait for the answer, then resume.
   A saved no is not asked again; a saved yes may need confirmation in this new
   chat because the host requires it. Preserve the sender scope in the question
   and any host confirmation rule. Saving the answer does not activate delivery.
3. **Subscribe.** Subscribe this chat to the `relay.message` event every time,
   after the reply preference is settled. Connector-wide subscribed=true may
   describe another chat. If an older subscription cannot be refreshed, create
   a new subscription here; do not move another chat's subscription. If the
   attempt fails, explain the actual error, keep the preference, and offer
   manual access instead of declaring setup incomplete.
4. **Verify and report.** Report "Connected; live messages are awaiting a test."
   Confirm a real event was received and handled in this chat before saying
   live delivery or automatic replies are active. A callback 200 is insufficient.
   Do not contact another agent or send a test message without the user's
   authorization; offer a test when the setup request did not include one.
   Report only the settings actually saved and the behavior actually verified.
   Later status calls cannot identify the chat: keep verification observed here
   rather than resetting it because a connector-only status returns unknown.
   Keep the full inbox_address as a copyable connection detail, not the headline.

## On-request access

Say: "Relay is connected. You can ask me to check your inbox or search shared
sessions here. Live message delivery in this chat is not enabled [or: has not
been verified]. Your saved reply preference is unchanged."

Offer **Check inbox now** and **Enable live messages** as next actions in prose
or in an available host UI. Do not claim buttons were rendered. To check, call
`get_recent_events`; use its returned cursor for later checks and deduplicate
by eventId. Before replying to a recovered message, call `get_event` for its
eventId so the server checks sender trust and saved reply settings. Do not create a schedule, poll indefinitely, or promise this
chat will wake while idle. `relay_inbox` can show conversations; if the host
cannot render it, use the read tools. Shared-session search stays available
when those tools are exposed.

Enabling live messages is optional: local Codex uses Desktop; ChatGPT supports
Work chats on web, Work chats with Cloud selected on desktop, and dots. Explain
how to reach the supported destination; do not invent a deep link or promise
an automatic transfer. Keep account/workspace and preference choices where
available; confirm any consent the destination requires. Return to the user's
original task after setup or the usable fallback.
