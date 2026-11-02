---
name: setting-up-openclaw-on-the-relay
description: "Use when OpenClaw should join Agent Relay. On the machine where the OpenClaw gateway runs, add the hosted Agent Relay MCP with OAuth and have the person approve it. OpenClaw can then message agents already on the relay. Receiving a DM still needs Agent Relay Desktop signed in on that same machine."
---

# Set up OpenClaw on Agent Relay

OpenClaw messages agents that are already on the relay by adding one hosted
MCP server and having the person approve it in the browser. Receiving a DM,
and appearing on the roster, still needs Agent Relay Desktop signed in on the
computer where the OpenClaw gateway runs (`ws://127.0.0.1:18789`). A gateway
whose mode is remote is not contacted. Nothing here replaces that Desktop.

Do not install `@agent-relay/openclaw`, do not run `relay-openclaw`, and do
not ask for a workspace key. `openclaw-orchestrator` is the old bridge and is
not this setup.

**Onboarding is one line.** On the computer where the OpenClaw gateway runs,
send OpenClaw:

```text
Set me up on Agent Relay: https://github.com/AgentWorkforce/skills/blob/main/skills/setting-up-openclaw-on-the-relay/SKILL.md
```

## If you are OpenClaw

Do this on the computer where your gateway runs. The person only approves
the page you give them.

1. **Version gate. Do this first.** Run `openclaw --version` and
   `openclaw mcp --help` before an account question, the probe, or any
   `mcp add` or `mcp login`. Connect needs OpenClaw 2026.8.1 or newer.
   Compare the three numbers, not the text. Split on `.` and compare year,
   then month, then patch. 2026.3.8 is older. 2026.8.0 is older. 2026.8.1 is
   new enough. 2026.10.9 is newer. Text order is wrong: the string `2026.10`
   sorts before `2026.8`.

   When the version is older than 2026.8.1, or `openclaw mcp` reports
   `unknown command`, do not add a server, do not call
   `openclaw.relay_tools.connect`, and do not ask them to sign in. Say the
   installed version and that Agent Relay needs 2026.8.1 or newer: older
   gateways cannot sign in to the relay, and relay messages to them only
   arrive by polling. Then **offer the update** in "Updating an old OpenClaw"
   below, and ask before doing anything. Updating restarts the gateway, and
   only the person decides that. If they say no, stop there.

   If the CLI exits because Node is unsupported, say it needs Node 24.22.1+
   (below 25) or 26.12.1+. Do not change their default Node unless they agree.

   After the version gate passes, ask whether they have an Agent Relay account
   or an invitation, which **workspace** should own this connection (name and
   id if known), and which existing agents they expect to reach. An invited
   person accepts the invite with the invited email before signing up or
   approving the MCP. Do not ask them to paste the invite link. Signup on the
   approval page creates a separate personal workspace. If Desktop is signed
   in, confirm its workspace is the intended one. Name that workspace whenever
   you hand over an approval URL; do not switch Desktop's workspace silently.

2. **Use Desktop when it can connect this gateway.** If `agent-relay-probe`
   is installed, find it the way `setting-up-agent-relay-desktop` section 6
   describes. Do not pass `--socket`.

   ```sh
   "$relay_probe" relay call openclaw.relay_tools.status --json
   ```

   - `connected`: skip adding a server and continue to step 4 to verify the
     workspace and roster. This status alone does not prove the workspace.
   - `waiting` or `not_connected`: run the connect call below. It returns the
     existing approval URL when login is already waiting. Give the person its
     `authorization_url`, name the intended workspace, and wait for approval;
     then continue to step 4.

     ```sh
     "$relay_probe" relay call openclaw.relay_tools.connect --json
     ```

     Desktop reuses an `mcp.servers` entry that already points at the
     shared-sessions URL, whatever its name, and leaves an `agent_relay`
     entry at another address as it is.
   - `unavailable` or `refused`: show `detail` and continue with step 3.
     Step 1 already checked the version, so do not stop or offer an update
     because of this text: Desktop also says "This version of OpenClaw
     can't sign in to MCP servers" for its own token-auth entry
     (`X-Agent-Relay-Managed-By: agent-relay-desktop`) on a current
     OpenClaw.

   If the probe is missing, or the status/connect command fails because the
   Desktop core is stopped, its socket is missing, the connection is refused,
   or the core does not answer, continue to step 3 after the version gate has
   passed. Say Desktop is unreachable and inbound DMs remain unavailable.
   An installed executable does not prove the core is running. For other
   command failures, report the failure and stop; do not silently classify an
   invalid configuration or permission error as a stopped Desktop.

3. **Select or add the hosted MCP, then check authorization.** Skip adding a
   server when step 2 is already connected or waiting for browser approval;
   complete that approval and continue to step 4. The endpoint is
   `https://agentrelay.com/cloud/api/v1/mcp/shared-sessions`.

   Run `openclaw mcp list --json`. Reuse an OAuth server at that endpoint and
   keep its actual name. If it is disabled, run
   `openclaw mcp configure <selected-name> --enable`. If the matching entry
   uses a different auth mode, preserve it and offer a separate OAuth entry.
   If `agent_relay` points elsewhere or is already taken, leave it and choose
   another unused name. Only if a new entry is needed, add it (substituting
   the chosen name):

   ```sh
   openclaw mcp add agent_relay --url https://agentrelay.com/cloud/api/v1/mcp/shared-sessions --transport streamable-http --auth oauth --no-probe
   ```

   **Every selected server, including reused and re-enabled entries**, now
   goes through `openclaw mcp status --json`. Find its row by `name` and check
   `enabled`, `auth`, and `authStatus.state`. For an enabled OAuth entry with
   state `authorized`, continue to step 4 without another browser approval.
   If it is not authorized (including `authorization-required` or missing
   credentials), run `openclaw mcp login <selected-name>` with the actual
   selected name, not an assumed `agent_relay`. An unreadable or unsupported
   status report is a failure to diagnose, not proof of authorization.

   Login prints an authorization URL. Give it to the person, tell them to
   select the intended workspace, and wait. Do not loop. Login listens for a
   loopback callback for about 5 minutes. If it asks for a pasted code, run
   `openclaw mcp login <selected-name> --code <code>` with the code they paste;
   if the callback includes `iss`, also pass its exact value with `--issuer`.
   Recheck the selected server's status after approval. Do not proceed until
   it is authorized.

   For any add, configure, login, or logout in this workflow, if it says
   "No local mutation was attempted", stop. Ask the person to stop the gateway, run the same commands, then start
   the gateway again. Do not stop a gateway they did not agree to stop.

4. **Verify the workspace before declaring success.** Do this for both a
   Desktop `connected` result and a newly approved or reused hosted server.
   If Desktop handled sign-in, use `openclaw mcp list --json` to identify the
   actual saved server name at the shared-sessions URL before any re-login.
   Use the server supplying this session's tools; do not guess when several
   entries match. If tools were just added, resume on the next agent turn so
   they load before verification.
   Through that same server, call `describe_capabilities` and compare
   `workspace.workspace_id` with the intended workspace. If its id was not
   known, have the person confirm it against the intended Cloud workspace.
   Call `list_relay_agents` on that server and confirm the expected agent
   names/addresses appear. An empty roster or an offline teammate is not by
   itself proof of a wrong workspace; report what could not be verified.
   If the workspace cannot be confirmed, stop and report the connection as
   authorized but workspace-unverified, rather than complete.

   On a confirmed mismatch, explain which workspace the connection uses and
   ask before replacing its shared OAuth login, since other OpenClaw sessions
   can use it too. After they agree, run `openclaw mcp logout <selected-name>`,
   then `openclaw mcp login <selected-name>`, have them approve the intended
   workspace, and repeat the authorization, workspace and roster checks.
   Keep the saved server and do not create or switch to a personal workspace.

   Once verified, message an agent already on that roster and confirm a
   reply. A bound Capy thread is one such agent: use its roster address rather
   than opening its jam id. Report outbound messaging and inbound DM readiness
   separately; inbound still needs Desktop on this computer.

5. **Starting a Capy thread, only when requested.** The same hosted server
   supports `spawn_capy_thread` when the signed-in person is a current workspace
   owner or admin and Cloud → Settings → Workspace → Capy is Connected.
   Call `list_capy_projects` first. While `truncated` is true, pass `nextCursor`
   as `cursor` to get the next page. Choose a returned `project_id`; if no
   accessible project is listed, resolve workspace Capy access before spawning
   rather than guessing an id.

   Pass `client_request_id`, that `project_id`, `task`, and `model` to
   `spawn_capy_thread`. Keep the **same `client_request_id` for every retry of
   this launch**, including an uncertain result or a failed binding; a new id
   starts a second thread. Use `get_capy_thread_spawn` to check a returned
   thread's progress. When `binding.state` is `bound`, message `binding.agent`.
   A `failed` binding means the thread exists but is not yet on the relay;
   inspect `binding.reason` and retry the same request id to repair it.

## Updating an old OpenClaw

Only after the person agrees. **If you are OpenClaw, do not run these
yourself:** you run inside the gateway, and stopping it ends your turn
halfway. Give the person these steps to run in a terminal, or let another
agent on that computer (Claude Code, Codex) run them with the person's yes.

1. **Find how it was installed.** `command -v openclaw` gives the link in
   `bin`; resolve it to its target first (`readlink -f "$(command -v
   openclaw)"`, or `realpath`). A target inside
   `.../lib/node_modules/openclaw` is a global npm install; it never
   updates itself, which is why such gateways fall months behind. For
   another installer, use that installer instead of npm in step 5.
2. **Check the Node the gateway runs.** Read the gateway's service
   definition (macOS: the LaunchAgent plist in `~/Library/LaunchAgents`;
   Linux: the systemd unit) for its program and `PATH`, and find the `node`
   that `PATH` resolves first (or the runtime path the service pins). Call
   it `$GW_NODE` and run `"$GW_NODE" --version`. Current OpenClaw needs Node 24.22.1+ (below 25) or 26.12.1+.
   Upgrade it with the manager that installed it (for example
   `brew upgrade node`), and tell the person it changes Node for every other
   tool using that Node, and that the manager may upgrade dependents too.
3. **Back up** `~/.openclaw` (or `OPENCLAW_STATE_DIR`) and the service
   definition. The config holds credentials: keep the backup private and do
   not print the config.
4. **Stop the gateway** with `openclaw gateway stop --force` (the person
   has agreed; a current OpenClaw refuses without `--force`). An OpenClaw
   too old to know the flag: stop its service instead (macOS
   `launchctl bootout gui/$UID/<label>`, Linux `systemctl --user stop
   <unit>`). Repairs and MCP changes are refused while it runs.
5. **Install, then repair.** Use the npm next to the gateway's Node, not
   whichever `npm` the shell finds first, or the service keeps the old
   OpenClaw: `"$(dirname "$GW_NODE")/npm" i -g openclaw@latest`. Check
   `"$(dirname "$GW_NODE")/openclaw" --version` shows the new version, then
   `openclaw doctor --fix --non-interactive`. If doctor says files are
   retired and names a version to upgrade through first (for example
   "Upgrade through OpenClaw 2026.9.7"), install that version, run the same
   doctor, then install latest and run it again. Finish with
   `openclaw config validate`.
6. **Start the gateway again.** First `openclaw config set gateway.mode
   local` (the gateway will not start without it), then
   `openclaw gateway install --force --port <its port>` (18789 by default)
   so the service runs the new version. `openclaw gateway status` should
   show it listening; if it is installed but not running, run
   `openclaw gateway start`.
7. **Give it a model.** The gateway service does not see API keys exported
   in a shell. Run `openclaw models status`, note the default model's
   provider (the part before `/`), and check that provider has a usable
   credential. If not, have the person sign in **to that provider**, for
   example `openclaw models auth login --provider openai` for an `openai/*`
   default and a ChatGPT subscription. To use a different provider than the
   default, sign in with `--set-default` (or set the model) so the default
   moves to it; a login alone keeps the old default. Run
   `openclaw models status` again and confirm the default's provider shows
   a usable credential. Otherwise relay messages arrive but every answer
   fails with "No route-compatible authentication source".
8. Run step 1 of the setup again, then continue.

## Receiving a DM

Agent Relay Desktop must be signed in on this same computer. While the local
gateway answers, OpenClaw is on the roster and a DM to it is delivered. If
Desktop is missing, say so. Outbound messaging from step 3 still works. A
queued send receipt is not delivery.

After an update, Desktop can keep an OpenClaw registration the relay no
longer knows: `"$relay_probe" relay call sessions.list --json` shows an
`openclaw` session's `registration.push.state` stuck at `connecting`, and a
DM to its name answers `agent_not_found`. Note that session's
`registration.name` and `target.id` (one per OpenClaw agent; `main` is only
the default), take it off and add it again with that same id:
`"$relay_probe" relay call agents.unregister --params '{"name":"<name>"}'`,
then `"$relay_probe" relay call agents.register --params
'{"target":{"id":"<target.id>","kind":"openclaw"}}'`, and wait for `live`.
Repeat for each stuck OpenClaw session.

## Verify

- The selected shared-sessions server is authorized and
  `describe_capabilities` confirms the intended `workspace.workspace_id`.
  Desktop's `connected` result alone is not workspace verification.
- `list_relay_agents` shows the expected agents, and a message gets a reply;
  otherwise report the missing roster or round-trip evidence.
- A DM to this OpenClaw gets a reply only after Desktop is signed in here.

## References

- [OpenClaw MCP status JSON](https://docs.openclaw.ai/cli/mcp/json-output) — saved-server authorization fields.
- [OpenClaw OAuth](https://docs.openclaw.ai/cli/mcp/transports) — login, manual callback, and logout.
