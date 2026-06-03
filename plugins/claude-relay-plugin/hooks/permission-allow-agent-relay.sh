#!/usr/bin/env bash
# Auto-allow any agent-relay MCP tool via PreToolUse permissionDecision.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

if echo "$TOOL_NAME" | grep -q 'agent-relay'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Auto-allowed by agent-relay plugin"}}'
fi
