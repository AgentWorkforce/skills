# Freestyle command-line setup

Start with the [official index](https://www.freestyle.sh/docs/llms.txt),
[documentation skill](https://www.freestyle.sh/docs/onboard.md), and
[command-line reference](https://www.freestyle.sh/docs/cli). The installed
version was 0.2.21.

```sh
npm install -g freestyle@0.2.21
freestyle --version
freestyle login --no-browser
freestyle whoami
freestyle team current
freestyle --output json vm list
```

Open the printed secure approval URL. The observed page required the person to
click **Allow access** and stated that official command-line authorization covers
all accessible Freestyle accounts, with the selected team as default. Respect
that human approval. Browser sign-in supplies a refresh session; it is not
necessary to mint a permanent account API key for command-line work.

## VMs and source snapshot

```sh
freestyle --output json vm create \
  --snapshot-id freestyle/ubuntu-sm --slug YOUR_UNIQUE_TEST_SLUG \
  --no-ssh --ephemeral --idle-timeout-seconds 1800 \
  --metadata purpose=relay-qualification
freestyle --output json vm get YOUR_RECORDED_VM_ID
```

Record the returned exact ID immediately. Do not use `--replace-slug` to take
another VM's name. The qualification used three copies of snapshot
`sh-3556b17912bc4dfc83142b4dcddf3fe5`, resolved from `freestyle/ubuntu-sm`:
2 vCPUs, 4,096 MiB and 16 GiB storage, Ubuntu 24.04.5, linux/amd64.
This is the smallest Ubuntu stock size in the docs read for this run. Prefer
an existing immutable snapshot ID when reproducing the environment.

An initial default-size 4-vCPU/8-GiB VM passed a short command check and was
deleted; it did not participate in the qualification or benchmark.

`--ephemeral` sets `autoDeleteSeconds: 0`; stopping the VM deletes it. The idle
timeout above bounds inactivity, not total running time. Record exact IDs and
perform explicit cleanup even if background services keep the VM active.
The response did not provide a physical region, so do not claim same-region
parity with another provider.

## Commands and file copying

```sh
freestyle vm exec --linux-user root --timeout-ms 300000 YOUR_VM_ID -- \
  bash -lc 'echo ready; uname -m'
# The default SCP identity owns this private staging directory. Record its UID.
freestyle vm exec YOUR_VM_ID -- bash -lc \
  'set -eu; umask 077; mkdir -m 0700 /tmp/relay-private-stage; id -u'
freestyle vm scp private-bundle.tar.gz YOUR_VM_ID:/tmp/relay-private-stage/bundle.tar.gz
freestyle vm exec --linux-user root YOUR_VM_ID -- \
  bash -lc 'set -eu
    stage=/tmp/relay-private-stage
    archive=$stage/bundle.tar.gz
    test -d "$stage"
    test ! -L "$stage"
    test -f "$archive"
    test ! -L "$archive"
    trap '\''rm -f "$archive"'\'' EXIT
    chmod 0700 "$stage"; chmod 0600 "$archive"
    chown root "$stage" "$archive"
    install -d -m 0700 /app/relay-test
    tar -xzf "$archive" -C /app/relay-test'
```

The archive must contain only reviewed, task-owned paths; never extract
untrusted content as root. Entries are relative to `/app/relay-test`. Use a 0600 local archive in a private directory,
0600 private entries and 0700 runtime directories. Remove the temporary remote
archive on both successful and failed extraction (the EXIT trap retains tar's
failure status). Create a fresh 0700 staging directory as the SCP identity before
copying; it stays private during transfer and becomes root-owned before
extraction. The default SCP identity is trusted during this transfer; 0700
prevents other guest UIDs from reading it, and this does not claim isolation
from processes sharing that identity. Never reuse an unrelated or permissive
staging path. Do not put
credential values in argv or use account keys as agent runtime keys.

Do not pipe private binary bundles through `vm exec -i` on command version
0.2.21: its implementation opens a PTY and does not forward stdin EOF. That
path can echo/corrupt binary input or leave `cat` waiting. Use the private SCP
staging recipe above; a root-owned directory before copying would be
inaccessible to the default SCP identity.

The stock Node was 26.13.0. This run installed verified official Node 22.23.2
in `/opt/node` to match E2B's tested runtime. The historical fixture used
`HOME=/root`; the maintained fixture gives the core and Pi a separate
`/app/relay-test/pi-home`. Supervisors used `nohup`,
closed stdin, private logs and exact PID files; actual fresh file/message
checks establish that they keep running after the command returns.

## HTTPS routes

Create only routes required for the approved test, using unused `style.dev`
names rather than changing a customer's domain:

```sh
freestyle --output json tls create --domain YOUR_UNIQUE_NAME.style.dev \
  --from public --to vm=YOUR_VM_ID,port=9090
```

Record the returned `tls-...` ID. The run created four routes: Relayfile 9090
and messaging proxy 8787 on the service VM, plus callback 9092 on each peer.
All file operations and callbacks require application bearer authentication.
Verify 401 without a bearer; public TLS routing alone is not access control.
Messaging workspace bootstrap stays on service loopback and is blocked at the
external proxy. Route WebSocket upgrades correctly.

## Cleanup

```sh
freestyle tls delete YOUR_EXACT_SESSION_OWNED_RULE_ID
freestyle vm delete YOUR_EXACT_SESSION_OWNED_VM_ID
freestyle --output json vm get YOUR_EXACT_SESSION_OWNED_VM_ID
```

Delete each recorded route and VM separately, verify exact IDs are absent or
ended, and preserve unrelated resources. No snapshot creation was required;
do not delete the shared stock snapshot.

See [qualification evidence](evidence/freestyle/qualification.json),
[native shell proof](evidence/freestyle/native-tool-proof.json), and the
[benchmark report](benchmarks.md).
