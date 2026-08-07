#!/usr/bin/env bash
# usage: assert-known-true-now.sh <workspace> <local-mirror-dir> <by-id-dir> <identifier>
set -uo pipefail
WS="${1:?workspace}"; MIRROR="${2:?local mirror dir}"
BY_ID_REL="${3:?by-id directory relative to mirror}"; KNOWN="${4:?known identifier}"
case "$BY_ID_REL" in /*) ;; *) echo "by-id directory must start with /" >&2; exit 2;; esac
BY_ID="$MIRROR$BY_ID_REL"
NEWEST=$(ls "$BY_ID"/*.json 2>/dev/null | xargs -n1 basename | sed 's/\.json$//' | sort -n | tail -1)
echo "newest projected: #$NEWEST | known-true-now: #$KNOWN"
shopt -s nullglob
known_files=("$BY_ID/${KNOWN}"__*.json)
for file in "${known_files[@]}"; do
  if [[ -f "$file" ]]; then
    echo "ASSERT known-true-now: PASS"
    echo "  mount: workspace=$WS mirror=$MIRROR scope=$BY_ID_REL"
    exit 0
  fi
done
echo "ASSERT known-true-now: FAIL — #$KNOWN absent; projection is behind reality"
echo "  mount: workspace=$WS mirror=$MIRROR scope=$BY_ID_REL"
exit 1
