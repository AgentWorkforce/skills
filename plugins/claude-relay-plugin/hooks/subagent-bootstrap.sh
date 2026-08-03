#!/usr/bin/env bash

set -euo pipefail

AGENT_NAME="${RELAY_AGENT_NAME:-the assigned subagent name}"

cat <<EOF
MANDATORY relay setup — complete these steps IN ORDER before any other work:

1. Call \`register_agent(name: "$AGENT_NAME", type: "agent")\` to register with the relay.
   The workspace is already pinned to this project, so the relay MCP server resolves it
   for you — you do NOT need a workspace key, and must never print or ask for one.
   If this fails with "Workspace key not configured", report that to your lead.
2. Call \`check_inbox(as: "$AGENT_NAME")\` to get your task assignment.
3. Send an ACK to your lead via \`send_dm(as: "$AGENT_NAME")\` when you understand the task.
4. When finished, send a DONE message with a concise completion summary via \`send_dm(as: "$AGENT_NAME")\` before stopping.

IMPORTANT: Include \`as: "$AGENT_NAME"\` on EVERY relay tool call to ensure correct message attribution.

Do NOT skip step 1. Without it you cannot send or receive messages.
EOF
