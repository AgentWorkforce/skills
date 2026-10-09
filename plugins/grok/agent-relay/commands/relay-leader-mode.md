---
description: Check Grok leader mode for Agent Relay delivery into this session, and turn it on only if the person agrees
---

Check whether Agent Relay can deliver into **this** Grok session, which needs
Grok's leader mode, and offer to turn leader mode on. Do not change anything
without an explicit yes from the person in this conversation.

1. Find the desktop's probe (first that exists):
   `$HOME/.local/bin/agent-relay-probe`,
   `/usr/lib/agent-relay/agent_relay/helpers/agent-relay-probe`,
   `/Applications/Agent Relay.app/Contents/Helpers/agent-relay-probe`, or
   `find "$HOME/.local/lib/agent-relay" -type f -perm -u+x -path '*/agent_relay/helpers/agent-relay-probe' -print -quit`.
2. Read the current state, changing nothing:
   - `grep -nE '^\s*use_leader\s*=|^\s*\[cli\]' ~/.grok/config.toml` (no match means off).
   - With the probe: `<probe> relay call settings.get` → `result.grok_leader`, and
     `<probe> relay call sessions.list` → the row whose `target.id` is
     `$GROK_SESSION_ID`, and its `live` flag.
   - Without the probe, only the config can be read: a reachable leader in
     `grok leader list` may belong to another session, so it does not show
     that Agent Relay can deliver into this one. Report "off" when the config
     has no `use_leader = true`; otherwise say leader mode is configured but
     the desktop (its probe) is needed to confirm delivery into this session,
     and stop.
3. Report one of these, in one or two lines, and act as it says:
   - **This session's row is `live: true`:** leader mode is working for this
     session. Nothing to change, no restart. Stop.
   - **Leader mode is on, but this session has no live row** (no row, `live:
     false`, or no reachable leader): it is configured but not active for this
     TUI, which started before it was on or without a leader. Tell the person
     to quit and start a new `grok` session (or `grok --leader`), then run
     `/setting-up-agent-relay-for-grok` there. Change nothing.
   - **Leader mode is off:** ask: "Turn on Grok leader mode (`[cli]
     use_leader = true` in ~/.grok/config.toml) so Agent Relay can deliver
     messages into Grok? It applies to Grok sessions started afterwards."
     Offer the one-off alternative: start the next session with
     `grok --leader`, which changes no config.
4. Only on yes:
   - With the probe, let the desktop make the edit, which rewrites only that
     line and backs the file up once to `config.toml.relay-desktop-backup`:
     `<probe> relay call settings.set --params '{"grok_leader":true}'`, then
     confirm with `<probe> relay call settings.get` that `result.grok_leader`
     is `true`. If it is not, report why it did not apply and stop.
   - Without the desktop, show the person the exact two lines to add under
     `[cli]` and let them edit the file themselves. Do not edit
     `~/.grok/config.toml` yourself.
   - Then tell them to quit and restart Grok and run
     `/setting-up-agent-relay-for-grok` in the new session.

Leader mode is refused under a `--sandbox` profile and can be pinned by an
organisation's managed config; if so, report that and stop.
