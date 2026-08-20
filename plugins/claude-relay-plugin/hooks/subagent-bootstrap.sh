#!/usr/bin/env bash

set -euo pipefail

AGENT_NAME="${RELAY_AGENT_NAME:-the assigned subagent name}"

cat <<EOF
MANDATORY relay setup — complete these steps IN ORDER before any other work:

1. Call \`register_agent(name: "$AGENT_NAME", type: "agent")\` to register with the relay.
   The workspace is already pinned to this project, so the relay MCP server resolves it
   for you — you do NOT need a workspace key, and must never print or ask for one.
2. Call \`check_inbox(as: "$AGENT_NAME")\` to get your task assignment.
3. Send an ACK to your lead via \`send_dm(as: "$AGENT_NAME")\` when you understand the task.
4. When finished, send a DONE message with a concise completion summary via \`send_dm(as: "$AGENT_NAME")\` before stopping.

IMPORTANT: Include \`as: "$AGENT_NAME"\` on EVERY relay tool call to ensure correct message attribution.

IF STEP 1 FAILS (for example "Workspace key not configured"): stop. Do not retry, and do
not attempt any other relay call — every one of them needs the registration you just failed
to get, so they will fail too. Relay is unavailable to you, which means you cannot tell your
lead over relay. Report the exact error as your final response instead; that text is what
your lead receives back from the Agent call. Do not ask anyone for a workspace key.

IF STEP 2 RETURNS NO ASSIGNMENT: you may have registered into a different workspace than
your lead (the project pin is shared by everything running in this directory). Do not guess
at the work. Report that as your final response so the lead can re-spawn you.
EOF
