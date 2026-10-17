#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
source_skill="$repo_dir/skills/agent-relay-grok-bot/SKILL.md"
bundled_skill="$repo_dir/plugins/grok-bot/skills/agent-relay-grok-bot/SKILL.md"

if [[ "${1:-}" == "--check" ]]; then
  cmp "$source_skill" "$bundled_skill"
elif [[ $# -eq 0 ]]; then
  mkdir -p "$(dirname "$bundled_skill")"
  cp "$source_skill" "$bundled_skill"
else
  echo "Usage: $0 [--check]" >&2
  exit 2
fi
