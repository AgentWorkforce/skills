#!/usr/bin/env bash
# usage: assert-known-true-now.sh <workspace> <local-mirror-dir> <by-id-dir> <identifier>
set -uo pipefail
WS="${1:?workspace}"; MIRROR="${2:?local mirror dir}"
BY_ID_REL="${3:?by-id directory relative to mirror}"; KNOWN="${4:?known identifier}"
case "$BY_ID_REL" in /*) ;; *) echo "by-id directory must start with /" >&2; exit 2;; esac
BY_ID="$MIRROR$BY_ID_REL"
shopt -s nullglob
projected_files=("$BY_ID"/*.json)
NEWEST=none
if (( ${#projected_files[@]} )); then
  NEWEST=$(printf '%s\n' "${projected_files[@]##*/}" | sed -E 's/\.json$//; s/__.*$//' | sort -n | tail -1)
fi
echo "newest projected: #$NEWEST | known-true-now: #$KNOWN"
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
