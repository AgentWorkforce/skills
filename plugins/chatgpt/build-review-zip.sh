#!/usr/bin/env bash
set -euo pipefail

plugin_dir=$(cd "$(dirname "$0")" && pwd)
repo_dir=$(cd "$plugin_dir/../.." && pwd)
output=${1:-"$repo_dir/agent-relay-chatgpt.zip"}
mkdir -p "$(dirname "$output")"
output=$(cd "$(dirname "$output")" && pwd)/$(basename "$output")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

cp "$plugin_dir/plugin.json" "$plugin_dir/mcp.json" "$stage/"
cp -R "$plugin_dir/.codex-plugin" "$plugin_dir/assets" "$stage/"
mkdir -p "$stage/skills"
cp -R "$repo_dir/skills/agent-relay-chatgpt-setup" "$repo_dir/skills/agent-relay-chatgpt" "$stage/skills/"
# Never ship interpreter caches from a local validation run.
find "$stage" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$stage" -type f -name '*.pyc' -delete

rm -f "$output"
(cd "$stage" && zip -qr "$output" .)
echo "$output"
