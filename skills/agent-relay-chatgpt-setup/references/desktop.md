# Connect the current local Codex session

Run the helper from this session's own shell so Relay can identify the caller
from process ancestry. Resolve the script relative to this installed skill,
not the current repository. Python 3.9+ is required; no Node, npm, Relay CLI,
MCP connection, hooks, or pasted API keys are needed. If Python is absent,
explain that prerequisite and offer manual inbox access; do not silently
install another language runtime.

1. Tell the person you will start or install Relay, guide sign-in, and connect
   this session. Run `python3 <skill-dir>/scripts/desktop_setup.py status`.
   Status never installs or downloads. A missing runtime is normal.
2. Run `python3 <skill-dir>/scripts/desktop_setup.py connect`. If the connected
   MCP supplies the intended Cloud workspace UUID, add `--workspace <UUID>`.
   A mismatch stops instead of switching workspaces. Preserve an existing
   workspace; do not mint a new Relaycast workspace or guess its key.
3. The helper starts an installed app/service first. Only when absent does it
   download the official macOS DMG or systemd Linux tarball and SHA-256 from a
   single pinned release. It verifies before installing; macOS also checks
   bundle identity, signature and Gatekeeper assessment. It installs per user
   without sudo when possible. An incompatible build returns setup_unsupported:
   explain the required update and rerun connect with --update. Do not update
   a working newer build or reinstall to fix a slow socket.
4. For sign_in_pending, open the returned verification_url_complete when
   present, including browser flows with no user_code. Otherwise show the
   verification_url and code. Only open an HTTPS URL from Relay's real sign-in
   response; never construct approval URLs or invent a code. On SSH/Linux the
   helper uses device approval. Rerun connect at the returned poll_after_seconds
   (or five seconds) until signed in; reuse the pending login rather than
   generating another. Keep each agent wait bounded and communicate progress.
   The browser owns account creation/workspace selection for a new user.
5. ready_to_test means this session is registered and reports direct delivery;
   it does not mean a message was received. A connect request authorizes setup,
   but ask before sending the optional self-test unless the person already
   requested verification. Run `python3 <skill-dir>/scripts/desktop_setup.py test`.
   Record its exact marker, end the turn, and wait for Relay's separately
   injected message. Only its arrival in this session verifies delivery.
   A returned marker/send receipt is not evidence of arrival. Do not reply to
   your own test over Relay or create a message loop.
6. Report the workspace and "Connected; live delivery verified" only after
   that arrival. Before it, say "Connected; awaiting a test message." Keep the
   local session address as a connection detail. Offer optional history sharing
   separately through Relay's session picker. Setup does not change sharing to
   new/all or select historical sessions. Do not claim history is searchable
   until an explicitly shared session is actually retrievable.

# Recovery

- Pending login: resume connect. Expired/denied/error: inspect Relay's sign-in
  error locally, explain its concrete cause, then restart sign-in as needed.
- Legacy uploader/schedule conflict: preserve it. Inspect before changing
  anything; do not send acknowledge_uninspected_schedules to silence the error.
- Wrong account/workspace: select the intended workspace in Relay, then resume.
  Do not sign the user out or silently switch a fleet to a personal workspace.
- Caller rejected: use the original Codex shell, not an unrelated terminal.
  Do not pass a fabricated session id or workspace credential.
- Managed policy/delivery_blocked: report that specific block. Never change
  managed settings, Codex approval policy, or another agent's settings.
- Linux: the per-user service requires glibc and systemd. Persistence after the
  last logout also requires the host's lingering policy; if not enabled, explain
  that limitation and let an administrator enable it. Do not claim reboot/logout
  persistence merely because the socket is available now.
- Unsupported host or cloud executor: keep remote inbox/search available on
  request. Explain the exact missing prerequisite, without requiring a Work
  chat as the way to finish local Codex setup.

Authoritative runtime contract:
https://github.com/AgentWorkforce/relay-desktop/blob/main/docs/agent-driven-setup.md
