# Maritime: account setup verified, runtime blocked

Official references: [agent-readable command guide](https://maritime.sh/docs/cli/llms.txt),
[command reference](https://maritime.sh/docs/cli), and
[API reference](https://maritime.sh/docs/api). Read the installed command's
`--help` and `guide --json` for the current schema.

```sh
npm install -g maritime-cli@2.2.0
maritime --version
maritime login --device --native --json
maritime whoami --json
maritime doctor --json
```

The secure device flow prints a short code and verification URL. Have the
person approve the official page, then continue automatically. `whoami` is a
local status check; `doctor` establishes that online credentials are valid.
Do not print the stored login token or mint permanent keys for this task.

## Actual gate

Sign-in completed and `doctor` reported reachable API and valid credentials.
The following approved disposable sandbox request returned **HTTP 402,
`plan_required`**:

```sh
maritime sandboxes create --name relay-proof-20261107-initial \
  --idle 10m --time-limit 30m --vcpu 1 --memory 2 --for-end-user --json
```

No sandbox was created. There are **no Maritime transfer timings, filesystem
checks, native session checks, or benchmark results** in this package. The
[exact blocker record](evidence/maritime/blocker.json) preserves the request ID
and command. A person must activate an appropriate plan or trial through
[Maritime billing](https://maritime.sh/dashboard/billing#plan) before runtime
work can continue. Plan activation and any payment/account terms need specific
human authorization; do not perform them as a setup workaround.

## Resume after the human resolves billing

The following is a documentation-based runbook, **not a verified integration**.

1. Confirm online credentials with `doctor`, inspect existing sandboxes, and
   retry one bounded create under a new task-owned name. A matching live name
   can return an existing sandbox; do not mistake reuse for session ownership.
2. Record the exact `sbx-...` ID, resource size, source template/image, placement
   if returned, and expiration before creating additional participants.
3. Inspect `maritime sandbox exec --help`, `cp --help`, and `url --help`.
   The singular `sandbox` group provides data-plane commands. The plural
   `sandboxes create` command uses duration flags (`--idle`, `--time-limit`);
   singular `sandbox create` has seconds-based variants. Do not mix them.
4. Verify a real guest command, architecture, libc, Python and Node. Select a
   glibc Linux/amd64 image for the retained Linux x64 native probe. Install
   dependencies only inside the explicitly authorized disposable environment.
5. Use the authenticated `sandbox cp` file channel for reviewed binaries and
   private bundles, and `sandbox exec ID -- COMMAND` for commands. Determine
   its foreground/detached lifetime behavior through installed help and an
   actual bounded liveness check before starting long-lived services.
6. `sandbox url ID PORT` returns a private token-bearing URL by default. Do
   **not** print or publish it. For an explicitly approved public preview,
   inspect `sandbox url ID PORT --public`; require application bearers on file
   and callback endpoints. Do not create public routes on an unrelated VM.
7. Follow [runtime setup](runtime.md) and [verification](verification.md), then
   run the same six benchmark cells only after real file and message proofs.
   Preserve raw failures and provider-specific limitations.
8. Inspect `maritime sandbox kill --help` before cleanup. Installed 2.2.0 help
   confirms the singular group includes this lifecycle operation, alongside its
   data-plane commands. Kill only exact sandboxes this run created, one at a time, using
   `maritime sandbox kill EXACT_ID --yes --json`, then read each exact ID and
   confirm ended/not-found state. Preserve shared templates and snapshots.

The documented idle policy does not count background commands alone as
activity. Port traffic, foreground commands and data-plane calls affect it;
verify actual behavior and retain a total time limit. Do not silently switch
an unattended test to unlimited keep-awake or a production agent deployment.
