#!/usr/bin/env bash
# Auto-allow any relaycast MCP tool via PreToolUse permissionDecision.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

echo "$(date) PreToolUse hook fired, tool_name=$TOOL_NAME" >> /tmp/relay-hook-debug.log

if echo "$TOOL_NAME" | grep -q 'relaycast'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Auto-allowed by agent-relay plugin"}}'
fi
