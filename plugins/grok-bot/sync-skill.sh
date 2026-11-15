#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--check" ) ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi
for skill_name in agent-relay-grok-bot agent-relay-grok-bot-selfhosted; do
  source_skill="$repo_dir/skills/$skill_name/SKILL.md"
  bundled_skill="$repo_dir/plugins/grok-bot/skills/$skill_name/SKILL.md"
  if [[ "${1:-}" == "--check" ]]; then
    cmp "$source_skill" "$bundled_skill"
  else
    mkdir -p "$(dirname "$bundled_skill")"
    cp "$source_skill" "$bundled_skill"
  fi
done
