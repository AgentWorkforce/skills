# E2B command-line setup

Official entry points: [agent guidance](https://e2b.dev/SKILL.md),
[documentation index](https://docs.e2b.dev/llms.txt), and
[command-line reference](https://docs.e2b.dev/cli). Prefer current `--help` to
old examples; the installed version was 2.23.0.

```sh
npm install -g @e2b/cli@2.23.0
e2b --version
e2b --help
e2b auth info
e2b sandbox list --format json
```

`auth info` may show configuration details; inspect its implementation/output
before retaining it. Do not publish account keys from the local configuration.
The qualification reused an existing sign-in. If sign-in is missing, use
`e2b auth login` and the official browser flow; never ask for a key in chat.
Do not create a permanent account API key as a substitute for usable sign-in.

## Create and record exact IDs

```sh
e2b sandbox create base --detach --timeout 3600
e2b sandbox info YOUR_RECORDED_ID --format json
e2b sandbox exec -u root YOUR_RECORDED_ID -- bash -lc 'echo ready; uname -m'
```

Create one ID per participant and, for an isolated qualification, one service
ID. `--detach` avoids an interactive terminal and its exit lifetime. Place E2B
options **before the sandbox ID**, then `--` before guest command arguments.
The timeout above kills the sandbox after one hour; do not accidentally leave
a paused snapshot by copying a pause-on-timeout example.

The stock `base` returned template ID `rki5dems9wqfm4r03t7g`, Debian 12,
linux/amd64, 2 vCPUs, 512 MiB, and envd 0.10.0. The template ID is not a
captured immutable build digest. The command-line response did not identify a
physical region. Record what the actual sandbox reports instead of inferring
placement from the account or hostname.

## Files and processes through the command-line tool

Version 2.23.0 supports piped stdin with EOF on this envd version. For an
authorized batch of files, build a local tar.gz containing only the reviewed
files and send its bytes on stdin:

```sh
e2b sandbox exec -u root YOUR_RECORDED_ID -- tar -xzf - -C / < private-bundle.tar.gz
e2b sandbox exec -u root YOUR_RECORDED_ID -- cat /app/shared/.relay/state.json
```

Use archive entry modes 0600 for private bundles and a 0700 parent directory;
upload executables separately or chmod only those reviewed executable paths.
Do not place secret contents in the shell command. Piped input works for binary
data; the qualification uploaded compressed binaries and scripts this way.
Never extract an untrusted archive into `/`.

The installed command implementation sets remote command timeout to zero.
`--background` disconnects after returning the process ID; an explicit sandbox
timeout still applies. The tested supervisors used `nohup` with stdin closed,
stdout/stderr in private log files, and exact PID files. Verify actual process
liveness and fresh data, not just submission success.

## Runtime compatibility

The stock Node was 20.9.0; Pi 1.3.0 needs Node >=22.19.0. The run installed
official **Node 22.23.2** in `/opt/node`, verified its archive against official
SHASUMS256, and used `PATH=/opt/node/bin:$PATH` for all supervised children.
Set `HOME=/root` consistently when executing as root so the probe and Pi use
the same fresh harness home.

An initial Node 24.22.2 service install drove the `better-sqlite3` native build
against the 512 MiB sandbox's memory limit; the guest became unresponsive. That
exact disposable sandbox was killed. A replacement using Node 22.23.2 completed
the install and qualification. This is a setup failure, not a transfer sample.
Do not repeat that resource-constrained native build indefinitely or hide it
by weakening TLS verification.

## Ingress and cleanup

The default public-domain host format was `PORT-SANDBOX_ID.e2b.app`, matching
the installed SDK's `getHost` construction. Confirm the actual domain for a
nondefault regional/custom deployment. The service used 9090 for Relayfile,
8787 for the messaging proxy, and each peer used 9092 for authenticated
benchmark callbacks. Require application bearer authentication and verify 401
without it. Block anonymous external messaging workspace creation.

```sh
e2b sandbox kill YOUR_EXACT_SESSION_OWNED_ID
e2b sandbox info YOUR_EXACT_SESSION_OWNED_ID --format json
e2b sandbox list --state running,paused --limit 0 --format json
```

Confirm not-found/ended state and an exhaustive listing. Check the installed
`--state` syntax before combining states; separate running and paused listings
are also suitable. Never use `kill --all`. Four preexisting E2B sandboxes were
present when this task began and were not used as test participants.

See [qualification evidence](evidence/e2b/qualification.json),
[native shell proof](evidence/e2b/native-tool-proof.json), and the
[benchmark report](benchmarks.md).
