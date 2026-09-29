---
name: setting-up-agent-relay-desktop
description: Set up or repair Agent Relay Desktop end-to-end from a running Codex or Claude session on macOS or Linux, including verified installation, headless systemd service, device sign-in, new-session uploads, self-registration, direct delivery, webhooks, GitHub subscriptions, and delivery verification. Use when a human asks an agent to install, configure, or finish desktop relay setup without walking through the app UI.
---

# Set Up Agent Relay Desktop

Complete the setup through the private session socket. Do not ask the human to
click through the desktop app. The only normal human step is approving one
device-login link when no reusable `agent-relay` CLI login exists.

The finished state is:

- the current release is installed and running;
- sign-in is complete;
- sharing mode is `new` (new sessions upload automatically);
- auto-activate is off unless the human explicitly requested it;
- this Codex or Claude session is registered and accepts direct delivery;
- the requested webhook and integration subscriptions work;
- the human receives the session's `agent@machine` address and verification evidence.

Never put a Cloud token, workspace key, agent token, or webhook secret in a
Relay message. The webhook secret is returned once to this local calling
session; keep it in a mode-0600 temporary file and delete the file after the
test.

## 1. Detect the host and current session

Run setup commands from this agent's own shell tool. Do not run them from an
unrelated terminal: the app identifies the caller from kernel credentials and
the Codex/Claude process ancestry.

```sh
uname -s
uname -m
test -n "${TMUX:-}" && printf 'session=tmux\n' || true
test -n "${SSH_CONNECTION:-}" && printf 'transport=ssh\n' || true
command -v systemctl >/dev/null && systemctl --user is-system-running || true
```

On the supported headless Linux path, expect current Ubuntu LTS, systemd, SSH,
and Codex or Claude in tmux. The app scans same-user process trees and TTYs; it
does not require the service itself to share the tmux session.

Find an existing socket without printing private files:

```sh
pointer="$HOME/.agentworkforce/desktop/relay-socket"
if test -r "$pointer"; then relay_socket=$(sed -n '1p' "$pointer"); fi
if test -z "${relay_socket:-}" && test -n "${XDG_RUNTIME_DIR:-}"; then
  relay_socket="$XDG_RUNTIME_DIR/agent-relay/relay.sock"
fi
test -S "${relay_socket:-/nonexistent}" && printf 'socket=%s\n' "$relay_socket"
```

If the socket exists, inspect it before installing anything:

```sh
curl -sS --unix-socket "$relay_socket" http://relay/setup/status | jq
```

Preserve a working newer install. Update an older install, or install when the
socket is absent. A `404` from `/setup/status` means the installed build is too
old for agent-driven setup and should be updated.

## 2. Install or update with checksum verification

Use a private temporary directory. Never skip the published SHA-256 check.

### Ubuntu LTS, headless `.deb` (preferred)

Select the release architecture and install:

```sh
case "$(uname -m)" in
  x86_64|amd64) relay_arch=x64 ;;
  aarch64|arm64) relay_arch=arm64 ;;
  *) printf 'Unsupported Linux architecture: %s\n' "$(uname -m)" >&2; exit 2 ;;
esac
relay_tmp=$(mktemp -d)
chmod 700 "$relay_tmp"
release=https://github.com/AgentWorkforce/relay-desktop-releases/releases/latest/download
curl -fL "$release/AgentRelay-Linux-$relay_arch.deb" -o "$relay_tmp/AgentRelay.deb"
curl -fL "$release/AgentRelay-Linux-$relay_arch.deb.sha256" -o "$relay_tmp/AgentRelay.deb.sha256"
(cd "$relay_tmp" && sed "s#AgentRelay-Linux-$relay_arch.deb#AgentRelay.deb#" AgentRelay.deb.sha256 | sha256sum --check -)
sudo apt-get install -y "$relay_tmp/AgentRelay.deb"
systemctl --user daemon-reload
systemctl --user enable --now agent-relay.service
sudo loginctl enable-linger "$USER"
systemctl --user is-active agent-relay.service
loginctl show-user "$USER" -p Linger
```

The unit runs `/usr/bin/agent-relay --headless`: no display, X server, or GTK
window is needed. If `.deb` installation is unavailable but the human approves
a per-user tarball installation, download the matching `.tar.gz` and
`.sha256`, verify it the same way, extract it under a versioned directory, and
copy its user unit to `~/.config/systemd/user/agent-relay.service` with an
`ExecStart` pointing at that tree. Do not improvise Alpine/RHEL packaging.

### macOS DMG

```sh
case "$(uname -m)" in
  arm64) relay_arch=arm64 ;;
  x86_64) relay_arch=x64 ;;
  *) printf 'Unsupported Mac architecture: %s\n' "$(uname -m)" >&2; exit 2 ;;
esac
relay_tmp=$(mktemp -d)
chmod 700 "$relay_tmp"
release=https://github.com/AgentWorkforce/relay-desktop-releases/releases/latest/download
curl -fL "$release/AgentRelay-macOS-$relay_arch.dmg" -o "$relay_tmp/AgentRelay.dmg"
curl -fL "$release/AgentRelay-macOS-$relay_arch.dmg.sha256" -o "$relay_tmp/AgentRelay.dmg.sha256"
(cd "$relay_tmp" && sed "s#AgentRelay-macOS-$relay_arch.dmg#AgentRelay.dmg#" AgentRelay.dmg.sha256 | shasum -a 256 --check -)
mount_point=$(hdiutil attach -nobrowse -readonly "$relay_tmp/AgentRelay.dmg" | awk '/\/Volumes\// {sub(/^.*\/Volumes\//,"/Volumes/"); print; exit}')
ditto "$mount_point/Agent Relay.app" "/Applications/Agent Relay.app"
hdiutil detach "$mount_point"
open -a "Agent Relay"
```

If `/Applications` needs administrator access, use `sudo ditto` only after the
human has authorized installation. Do not remove or overwrite another app with
an unexpected bundle identity.

After either install, wait up to 30 seconds for the pointer:

```sh
for _ in $(seq 1 30); do
  test -r "$HOME/.agentworkforce/desktop/relay-socket" && break
  sleep 1
done
relay_socket=$(sed -n '1p' "$HOME/.agentworkforce/desktop/relay-socket")
test -S "$relay_socket"
```

## 3. Sign in by device approval

Start sign-in with an empty object, or include the human-provided workspace
UUID. Do not guess a workspace id.

```sh
sign_in=$(curl -sS --unix-socket "$relay_socket" \
  -H 'Content-Type: application/json' \
  -d '{}' http://relay/setup/sign-in)
printf '%s\n' "$sign_in" | jq '{ok, data: {status: .data.status, verification_url: .data.verification_url, verification_url_complete: .data.verification_url_complete, user_code: .data.user_code, expires_at: .data.expires_at, interval: .data.interval}, error}'
```

If this returns `signed_in` with `reused_login:true`, the app reused an
eligible same-origin CLI or desktop login. No human action is needed.

For `pending_approval`, show the human the `verification_url_complete` when it
is non-null, otherwise show `verification_url` and `user_code`. On a headless
server the human can approve from any phone or browser. Do not create another
code while this one is pending. Wait at the reported interval and poll:

```sh
while :; do
  state=$(curl -sS --unix-socket "$relay_socket" http://relay/setup/status)
  phase=$(printf '%s' "$state" | jq -r '.data.sign_in // .error.code')
  case "$phase" in
    signed_in) break ;;
    denied|expired|error) printf '%s\n' "$state" | jq; exit 1 ;;
  esac
  sleep "$(printf '%s' "$sign_in" | jq -r '.data.interval // 5')"
done
```

## 4. Apply the safe defaults and register this session

New-session upload is on; new-session relay activation is off. Enable direct
delivery for this calling session, then register only this session:

```sh
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d '{"mode":"new"}' http://relay/setup/sharing | jq
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' http://relay/setup/auto-activate | jq
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d '{"enabled":true}' http://relay/setup/direct-delivery | jq
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d '{}' http://relay/register | jq
```

Only send `{"enabled":true}` to `/setup/auto-activate` when the human
explicitly asked to put every newly discovered session on the relay. Sharing
mode `new` and auto-activate are different settings.

`POST /register` discovers the nearest live Codex or Claude ancestor. A session
inside tmux over SSH is valid. Never pass a session id or token in the body.

## 5. Create and test the webhook

Capture the one-time secret without echoing it:

```sh
umask 077
hook_file=$(mktemp)
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d '{}' http://relay/webhooks >"$hook_file"
jq '{ok, created: .data.created, webhook_id: .data.webhook_id, url: .data.url, error}' "$hook_file"
```

When `created:true`, send a unique marker and wait for it to appear in this
session:

```sh
hook_url=$(jq -r '.data.url' "$hook_file")
hook_secret=$(jq -r '.data.secret' "$hook_file")
marker="agent-relay-webhook-test-$(date +%s)"
curl -fsS -X POST "$hook_url" \
  -H "Authorization: Bearer $hook_secret" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$marker\",\"source\":\"agent-driven-setup\"}"
rm -f "$hook_file"
unset hook_secret
```

Do not claim success merely because the POST returned 2xx. Confirm the marker
was injected into the session. If the webhook already existed, its secret is
correctly returned as null; do not revoke or recreate it without human
authorization. Ask for the existing secret or report that the delivery test
could not be repeated.

## 6. Subscribe requested integrations

Require the provider and exact resource from the human. For a GitHub PR:

```sh
resource='/github/repos/OWNER/REPO/pulls/NUMBER/**'
curl -sS --unix-socket "$relay_socket" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg resource "$resource" '{provider:"github",resource:$resource}')" \
  http://relay/integrations/subscribe | jq
```

Equivalent CLI form, when the CLI is available:

```sh
agent-relay integration subscribe github \
  --resource "/github/repos/OWNER/REPO/pulls/NUMBER/**" \
  --to "@AGENT_NAME" --no-input
```

For real GitHub verification, use a harmless event the human authorized on
that PR (for example, a test comment or requested bot review), then confirm the
event text is injected into this session. Do not create a PR comment, review,
or rerun without authorization. A successful subscribe response alone does not
prove end-to-end delivery.

## 7. Coexist with a REST-polling MCP

Do not disable the customer's polling consumer. Desktop injection acknowledges
only this registered agent's delivery queue and does not advance a separate
workspace consumer's cursor. A polling MCP should use its own identity/cursor,
not this session agent's `/v1/deliveries` token.

Injected text contains both the full Relaycast message id and a short `ref`.
When polling and injection can surface the same workspace message, deduplicate
on the full message id before acting. During verification, leave the poller
running, confirm it can still observe the test message, and confirm the agent
acts only once.

## 8. Final verification and report

Read status again:

```sh
curl -sS --unix-socket "$relay_socket" http://relay/setup/status | \
  jq '{version: .data.version, sign_in: .data.sign_in, sharing_mode: .data.sharing_mode, auto_activate: .data.auto_activate, uploader: .data.uploader, session: .data.session, webhook: .data.webhook, integrations: .data.integrations}'
```

Report the exact version, `signed_in`, sharing mode `new`, auto-activate state,
uploader health, session address, direct-delivery state, webhook test marker,
subscriptions, real GitHub event evidence, and polling-coexistence result.
Separate verified facts from steps that still require a human or external
event.

## Recovery and undo

- **Socket missing or slow:** check `systemctl --user status agent-relay.service`
  on Linux or `open -a "Agent Relay"` on macOS. Confirm the pointer names a
  socket. Never delete a live socket; restart the owning service/app.
- **`not_a_relay_session`:** the command is not a descendant of a supported
  live Codex/Claude session, or the session id/process start no longer matches.
  Run it through this agent's shell tool. In tmux, confirm the agent process and
  shell share the pane's process tree.
- **`not_signed_in`:** run `/setup/sign-in`; do not paste tokens into the
  request. Restart after `expired` or `denied` to obtain a new code.
- **`not_allowed` from `/register`:** enable the app's self-registration
  setting. Do not bypass it with workspace credentials.
- **Managed Claude policy:** if direct delivery reports `managed_policy`, the
  organization controls `crossSessionInbound`; report the policy block rather
  than modifying managed settings.
- **Undo registration:** `curl -sS --unix-socket "$relay_socket" -X DELETE http://relay/register | jq`.
- **Undo an integration:** send the same provider/resource JSON with `-X DELETE`
  to `/integrations/subscribe`.
- **Auto-activate accidentally enabled:** POST `{"enabled":false}` to
  `/setup/auto-activate`. This does not remove existing registrations.
- **Uninstall:** stop/disable the user service before removing the Linux
  package, or quit the Mac app before removing it. Do not delete app data or
  revoke webhooks unless the human explicitly asks for data removal.

