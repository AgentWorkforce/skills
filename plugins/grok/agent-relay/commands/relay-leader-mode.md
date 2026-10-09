---
description: Check Grok leader mode for Agent Relay delivery, and turn it on only if the person agrees
---

Check whether Grok's leader mode is on, which Agent Relay needs to deliver
messages into this Grok session, and offer to turn it on. Do not change
anything without an explicit yes from the person in this conversation.

1. Read the current state, changing nothing:
   - `grep -nE '^\s*use_leader\s*=|^\s*\[cli\]' ~/.grok/config.toml` (no match means off).
   - `grok leader list` (a `Reachable` leader means one is running now).
   - If the Agent Relay desktop is installed, also
     `agent-relay-probe relay call settings.get` and read `result.grok_leader`
     (the probe is at `~/.local/bin/agent-relay-probe`,
     `/usr/lib/agent-relay/agent_relay/helpers/agent-relay-probe`, or
     `/Applications/Agent Relay.app/Contents/Helpers/agent-relay-probe`).
2. Report what you found in one or two lines.
3. If it is off, ask: "Turn on Grok leader mode (`[cli] use_leader = true` in
   ~/.grok/config.toml) so Agent Relay can deliver messages into Grok? It
   applies to Grok sessions started afterwards." Offer the one-off alternative:
   start the next session with `grok --leader`, which changes no config.
4. Only on yes:
   - With the desktop installed, let it make the edit, which rewrites only
     that line and backs the file up once to `config.toml.relay-desktop-backup`:
     `agent-relay-probe relay call settings.set --params '{"grok_leader":true}'`.
   - Without the desktop, show the person the exact two lines to add under
     `[cli]` and let them edit the file themselves. Do not edit
     `~/.grok/config.toml` yourself.
5. Only if leader mode was just turned on (or the person will use
   `grok --leader`): tell them to quit and restart Grok, then run
   `/setting-up-agent-relay-for-grok` in the new session. If it was already
   on and a leader is reachable, say so and stop; no restart is needed.

Leader mode is refused under a `--sandbox` profile and can be pinned by an
organisation's managed config; if so, report that and stop.
