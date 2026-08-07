#!/usr/bin/env bash
# Read-side currency proof. See SKILL.md for when each projection mode is valid.
# usage: assert-mirror-current.sh <workspace> <local-mirror-dir> <remote-scope> <full|on-demand>
set -uo pipefail
WS="${1:?workspace}"; MIRROR="${2:?local mirror dir}"
SCOPE="${3:?remote scope}"; MODE="${4:?projection mode: full or on-demand}"

python3 - "$WS" "$MIRROR" "$SCOPE" "$MODE" <<'PY'
import json, os, subprocess, sys
ws, mirror, scope, mode = (sys.argv[1], sys.argv[2].rstrip('/'),
                           sys.argv[3], sys.argv[4])
if mode not in {"full", "on-demand"}:
    raise SystemExit("projection mode must be 'full' or 'on-demand'")

def page(path):
    """One cloud-side page. The CLI exposes nextCursor but cannot consume it."""
    try:
        r = subprocess.run(["relayfile", "tree", ws, path, "--depth", "1", "--json"],
                           capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return [], None, "tree timed out after 180s"
    if r.returncode != 0:
        return [], None, r.stderr.strip()[:120]
    try:
        d = json.loads(r.stdout[r.stdout.index('{'):])
    except (ValueError, json.JSONDecodeError) as e:
        return [], None, f"unparseable: {e}"
    if not isinstance(d, dict):
        return [], None, "tree response is not a JSON object"
    entries = d.get("entries")
    if not isinstance(entries, list):
        return [], None, "tree response has no entries array"
    cursor = d.get("nextCursor")
    if cursor is not None and not isinstance(cursor, str):
        return [], None, "tree response has an invalid nextCursor"
    return entries, cursor, None

def cloud_bytes(path):
    """Read the actual cloud artifact. Revision/size are diagnostics, not proof."""
    try:
        r = subprocess.run(["relayfile", "read", ws, path],
                           capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return None, "read timed out after 180s"
    if r.returncode != 0:
        return None, r.stderr.decode(errors="replace").strip()[:120]
    return r.stdout, None

def local_files(root):
    """Return logical paths below root; fail closed on cycles or walk errors."""
    paths, walk_errors, visited = set(), [], set()

    def visit(local_dir, logical_dir):
        resolved = os.path.realpath(local_dir)
        if resolved in visited:
            walk_errors.append(f"repeated resolved directory (cycle/alias): {logical_dir}")
            return
        visited.add(resolved)
        try:
            entries = list(os.scandir(local_dir))
        except OSError as e:
            walk_errors.append(f"cannot read {logical_dir}: {e}")
            return
        for entry in entries:
            logical = logical_dir.rstrip("/") + "/" + entry.name
            if ".relay" in logical.lstrip("/").split("/"):
                continue                         # reserved daemon state is not cloud content
            try:
                if entry.is_dir(follow_symlinks=True):
                    visit(entry.path, logical)
                elif entry.is_file(follow_symlinks=True):
                    paths.add(logical)
                else:
                    walk_errors.append(f"non-regular local entry: {logical}")
            except OSError as e:
                walk_errors.append(f"cannot inspect {logical}: {e}")

    visit(root, scope.rstrip("/") or "/")
    return paths, walk_errors

match = stale = missing = 0
bad, truncated, errors, cloud_paths = [], [], [], set()
queue, seen = [scope], set()

while queue:
    path = queue.pop(0)
    if path in seen:
        continue
    seen.add(path)
    entries, cursor, err = page(path)
    if err:
        errors.append((path, err)); continue
    if cursor:
        truncated.append(path)
    for e in entries:
        if not isinstance(e, dict):
            errors.append((path, f"invalid cloud entry: {e!r}")); continue
        p, typ = e.get("path"), e.get("type")
        if not isinstance(p, str) or not p.startswith("/"):
            errors.append((path, f"invalid cloud entry path: {p!r}")); continue
        parent = path.rstrip("/")
        if path != "/" and not p.startswith(parent + "/"):
            errors.append((path, f"cloud entry escaped listed directory: {p!r}")); continue
        if any(part in {"", ".", ".."} for part in p.split("/")[1:]):
            errors.append((path, f"cloud entry contains empty/dot component: {p!r}")); continue
        if ".relay" in p.lstrip("/").split("/"):
            continue
        if typ == "dir":
            queue.append(p); continue
        if typ != "file":
            errors.append((p, f"invalid cloud entry type: {typ!r}")); continue
        size, rev = e.get("size"), e.get("revision")
        cloud_paths.add(p)
        lp = mirror + p
        if not os.path.lexists(lp):
            missing += 1; bad.append(("MISSING", p, size, None, rev))
        elif not os.path.isfile(lp):
            errors.append((p, "local path is not a regular file")); continue
        else:
            try:
                with open(lp, "rb") as f:
                    local = f.read()
            except OSError as e:
                errors.append((p, f"cannot read local file: {e}")); continue
            cloud, err = cloud_bytes(p)
            if err:
                errors.append((p, f"cloud read failed: {err}")); continue
            if local == cloud:
                match += 1
            else:
                stale += 1
                bad.append(("STALE", p, size, len(local), rev))

checked = match + stale + missing
local_paths, walk_errors = local_files(mirror + scope)
errors.extend((scope, e) for e in walk_errors)
extra = sorted(local_paths - cloud_paths)
if not cloud_paths:
    errors.append((scope, "cloud listing contained no file paths; currency not proven"))
if mode == "on-demand" and match + stale == 0:
    errors.append((scope, "no local/cloud bytes were compared; currency not proven"))
fatal = stale or truncated or errors or extra
if mode == "full":
    fatal = fatal or missing
ok = not fatal

print(f"ASSERT mirror-matches-cloud ({mode}): {'PASS' if ok else 'FAIL'}")
print(f"  mount: workspace={ws} mirror={mirror} scope={scope}")
print(f"  checked={checked} match={match} stale={stale} missing={missing}")
print(f"  coverage: {len(cloud_paths)} cloud paths listed; {len(local_paths)} local paths under {scope}")
if truncated:
    print(f"  INCOMPLETE: {len(truncated)} dir(s) returned nextCursor and were only "
          f"partially listed — currency NOT proven for them: {truncated[:3]}")
if errors:
    print(f"  ERRORS: {errors[:3]}")
if extra:
    print(f"  EXTRA LOCAL PATHS (not in cloud listing): {extra[:10]}")
for b in bad[:10]:
    print("   ", b)
sys.exit(0 if ok else 1)
PY
