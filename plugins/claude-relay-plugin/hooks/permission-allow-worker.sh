#!/usr/bin/env bash
# Auto-allow relaycast, Bash, WebSearch, and WebFetch tools for relay workers.
# Reads the hook stdin JSON to check the tool_name.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

if echo "$TOOL_NAME" | grep -qE 'relaycast|^Bash$|^WebSearch$|^WebFetch$'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","permissionDecision":"allow","permissionDecisionReason":"Auto-allowed by relay-worker agent"}}'
fi
