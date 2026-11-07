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
freestyle vm scp private-bundle.tar.gz YOUR_VM_ID:/tmp/relay-stage.tar.gz
freestyle vm exec --linux-user root YOUR_VM_ID -- \
  bash -lc 'tar -xzf /tmp/relay-stage.tar.gz -C / && rm /tmp/relay-stage.tar.gz'
```

The archive must contain only reviewed, task-owned paths; never extract
untrusted content into `/`. Use a 0600 local archive in a private directory,
0600 private entries and 0700 runtime directories. Remove the temporary remote
archive after extraction so credential copies do not linger. Do not put
credential values in argv or use account keys as agent runtime keys.

The stock Node was 26.13.0. This run installed verified official Node 22.23.2
in `/opt/node` to match E2B's tested runtime. Use that PATH and `HOME=/root`
consistently for fresh root-owned probe/Pi homes. Supervisors used `nohup`,
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
