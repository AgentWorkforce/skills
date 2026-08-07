#!/usr/bin/env bash
# usage: assert-cross-host-write-visible.sh <workspace> <source-mirror> <target-mirror> <scope> <remote-file> <marker>
set -uo pipefail
WS="${1:?workspace}"; SOURCE_MIRROR="${2:?source mirror}"; TARGET_MIRROR="${3:?target mirror}"
SCOPE="${4:?shared writable scope}"; REMOTE_FILE="${5:?remote probe file}"; MARK="${6:?marker}"
case "$SCOPE" in /*) ;; *) echo "scope must start with /" >&2; exit 2;; esac
case "$SCOPE" in *//*|*/./*|*/../*|*/.|*/..) echo "scope must not contain empty or dot components" >&2; exit 2;; esac
case "$REMOTE_FILE" in /*) ;; *) echo "probe file must start with /" >&2; exit 2;; esac
case "$REMOTE_FILE" in *//*|*/./*|*/../*|*/.|*/..) echo "probe file must not contain empty or dot components" >&2; exit 2;; esac
if [[ "$SCOPE" == / ]]; then
  [[ "$REMOTE_FILE" != / ]] || { echo "probe file must name a file" >&2; exit 2; }
elif [[ "$REMOTE_FILE" != "$SCOPE"/* ]]; then
  echo "probe file must be inside declared scope" >&2; exit 2
fi
SOURCE_EXPECTED="$SOURCE_MIRROR$REMOTE_FILE"
TARGET_EXPECTED="$TARGET_MIRROR$REMOTE_FILE"
if [[ ! -f "$SOURCE_EXPECTED" ]] || ! grep -qF -- "$MARK" "$SOURCE_EXPECTED"; then
  echo "ASSERT cross-host-write-visible: FAIL — marker absent from exact source file" >&2
  echo "  mounts: workspace=$WS source=$SOURCE_MIRROR target=$TARGET_MIRROR scope=$SCOPE file=$REMOTE_FILE"
  exit 1
fi
for i in $(seq 1 12); do
  if cloud=$(relayfile read "$WS" "$REMOTE_FILE" 2>/dev/null) &&
     grep -qF -- "$MARK" <<<"$cloud" &&
     [[ -f "$TARGET_EXPECTED" ]] && grep -qF -- "$MARK" "$TARGET_EXPECTED"; then
    echo "ASSERT cross-host-write-visible: PASS after ~$((i*10))s"
    echo "  mounts: workspace=$WS source=$SOURCE_MIRROR target=$TARGET_MIRROR scope=$SCOPE file=$REMOTE_FILE"
    exit 0
  fi
  [ "$i" -lt 12 ] && sleep 10
done
echo "ASSERT cross-host-write-visible: FAIL (120s)"
echo "  mounts: workspace=$WS source=$SOURCE_MIRROR target=$TARGET_MIRROR scope=$SCOPE file=$REMOTE_FILE"
exit 1
