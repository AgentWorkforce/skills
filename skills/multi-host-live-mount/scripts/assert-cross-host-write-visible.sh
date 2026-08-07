#!/usr/bin/env bash
# usage: assert-cross-host-write-visible.sh <workspace> <source-mirror> <target-mirror> <scope> <remote-file> <marker>
set -uo pipefail
WS="${1:?workspace}"; SOURCE_MIRROR="${2:?source mirror}"; TARGET_MIRROR="${3:?target mirror}"
SCOPE="${4:?shared writable scope}"; REMOTE_FILE="${5:?remote probe file}"; MARK="${6:?marker}"
case "$SCOPE" in /*) ;; *) echo "scope must start with /" >&2; exit 2;; esac
case "$REMOTE_FILE" in "$SCOPE"/*) ;; *) echo "probe file must be inside declared scope" >&2; exit 2;; esac
EXPECTED="$TARGET_MIRROR$REMOTE_FILE"
for i in $(seq 1 12); do
  if [[ -f "$EXPECTED" ]] && grep -qF "$MARK" "$EXPECTED"; then
    echo "ASSERT cross-host-write-visible: PASS after ~$((i*10))s"
    echo "  mounts: workspace=$WS source=$SOURCE_MIRROR target=$TARGET_MIRROR scope=$SCOPE file=$REMOTE_FILE"
    exit 0
  fi
  [ "$i" -lt 12 ] && sleep 10
done
echo "ASSERT cross-host-write-visible: FAIL (120s)"
echo "  mounts: workspace=$WS source=$SOURCE_MIRROR target=$TARGET_MIRROR scope=$SCOPE file=$REMOTE_FILE"
exit 1
