---
name: using-pippen-sandboxes
description: Use when an agent needs a clean, throwaway AWS environment, a sandbox AWS account, or isolated test infrastructure (VPC, EKS, RDS, S3) for an AgentWorkforce product, for example an end-to-end self-host proof. Covers what Pippen Tools is, the AWS account naming, installing the pippen CLI, Roles Anywhere certificate auth, the pippen sandbox up/status/deploy/extend/down commands, the 3-hour lease, sweep and quarantine, what deploy creates today and what it does not, the approval boundary, who owns it, and when not to use it.
---

# Using Pippen sandboxes

Pippen Tools (`AgentWorkforce/pippen-tools`, private) is internal tooling.
Its first tool vends **one reusable AWS sandbox account per agent** in the
96Bulls AWS Organization. You lease the account for a session, deploy infra
into it, and every session ends with a sweep that has to prove the account is
empty.

The pippen-tools repo is the source of truth. This skill is a map. Where this
skill and the repo disagree, the repo wins. The account ids, role ARNs and
trust anchor ARNs you need are in the repo's docs, not here.

## Current status (2026-10-30)

Read the pippen-tools `README.md` and its open PRs before relying on anything
below. PR #20 records what the first real deploy verified. Things move fast
and this section can go stale without notice.

As of 2026-10-30, per pippin-tools-lead:

- **Verified live:**
  - client access: a Roles Anywhere cert, the SSM port forward (custom
    document, port 7096 only), `pippen sandbox status|up|down`, and SSM
    session cleanup;
  - `up` end to end: CreateAccount, move into the Sandbox OU, the baseline,
    and the session role;
  - `deploy`: CreateStack as the session, with the EKS cluster reaching
    CREATE_COMPLETE.
- **Not yet working:**
  - the node group failed on that run. The fix (#31) and sweeper fixes (#33)
    are merged on `main` but **not deployed**;
  - the only sandbox account (agent `bulls-lead`) is **quarantined**;
  - there is no agent with AWS access running the Pippen lane right now.

Bottom line on 2026-10-30: **you cannot get a working sandbox without
Khaliq first approving a deploy and either clearing the quarantine or creating
a new account.** Ask, don't try.

## When to use it

- You need real AWS infra that is not production and not shared: an
  isolated VPC, EKS cluster, RDS Postgres or S3 buckets to prove a deploy or
  run an end-to-end test.
- You want a fresh account you can throw away, where a sweep checks that
  nothing is left behind.

## When NOT to use it

- **Production, or anything touching real customer data.** Workload accounts
  such as `sessions-prod` are separate and are not reachable through Pippen.
- `sessions-dev` or any other shared `<product>-<stage>` workload account.
  Those are product environments, not sandboxes.
- Anything a local fake, the local kind backend or `npm run sim:e2e` in
  pippen-tools can answer. Use those first.
- GCP, Azure or Cloudflare. Only the AWS provider is real; the others are
  fakes (the service answers 501 `not_implemented`).

## Accounts

| OU | Account | Purpose |
| --- | --- | --- |
| root | the management account | Organizations, billing, Identity Center. No workloads |
| Infrastructure | `pippen-tooling` | runs the Pippen sandbox service |
| Workloads | `<product>-<stage>`, e.g. `sessions-dev`, `sessions-prod` | product environments |
| Sandbox | `sandbox-<agent>` | one reusable account per agent, swept after each session |

A sandbox account is created on the agent's first `up` and reused after that.
It is tagged `pippen:sandbox=true` and `pippen:agent=<agent>`.

## How it fits together

```
pippen CLI ── SSM port forward ──▶ pippen-tooling instance, 127.0.0.1:7096 (sandbox service)
  (pippen-sandbox-client,                └─ assumes the provisioner role in management
   short-lived, keyless)                     └─ sandbox-<agent> in the Sandbox OU
```

You never hold credentials for the sandbox account. The CLI only holds a
short-lived credential that can open the tunnel and prove who you are. The
service acts only for the agent named in your role session (`agent-<agent>`).

## Install

You need these on `PATH`:

- Node 24 or newer;
- AWS CLI v2;
- `session-manager-plugin`;
- `aws_signing_helper` (the IAM Roles Anywhere credential helper).

There are two ways to get the CLI:

- **Clone and run from source (use this today):**

  ```sh
  gh repo clone AgentWorkforce/pippen-tools && cd pippen-tools
  npm ci
  node bin/pippen.js sandbox status <agent>
  ```

- **`install.sh`** installs a standalone `pippen` binary from the latest
  GitHub release into `~/.local/bin`. The repo is private, so it needs a
  GitHub token (`gh auth login` or `GH_TOKEN`). See the pippen-tools README.
  **Caution:** on 2026-10-30 the only release is `v0.1.0`, which predates
  the SSM transport. Its CLI speaks only the dev `PIPPEN_TOKEN` HTTP mode and
  cannot reach the deployed service. Use the clone until a newer release
  exists (`gh release list -R AgentWorkforce/pippen-tools`).

## Auth: a Roles Anywhere certificate

Full steps: `docs/runbook-agent-certificates.md` in pippen-tools.

1. Make an EC P-256 key and a CSR whose only subject is `CN=<agent-id>`.
   Prefer a TPM or PKCS#11 key. For a software key, keep it readable only by
   you, ideally on tmpfs. The agent id matches `^[a-z0-9][a-z0-9-]{1,40}$`
   and never starts with `ci-`.
2. Send the CSR (public) to Khaliq. He issues a certificate from the
   `pippen-agents` CA, valid **at most 7 days**. There is no self-service
   issuer.
3. Set exactly these, and no other AWS credential source:

   | Variable | Value |
   | --- | --- |
   | `PIPPEN_RA_CERTIFICATE` | path to the cert, or a `pkcs11:` URI |
   | `PIPPEN_RA_PRIVATE_KEY` | path to the key, a TPM key or handle, or a `pkcs11:` URI |
   | `PIPPEN_RA_TRUST_ANCHOR_ARN` | from the tooling deploy (see the runbook) |
   | `PIPPEN_RA_PROFILE_ARN` | from the tooling deploy (see the runbook) |
   | `PIPPEN_RA_ROLE_ARN` | `arn:aws:iam::<pippen-tooling account>:role/pippen-sandbox-client` |
   | `PIPPEN_RA_SESSION_NAME` | `agent-<agent-id>`, exactly the CN with `agent-` in front |
   | `PIPPEN_REGION` | `us-west-2` |

4. Renew weekly, before the certificate expires. An expired cert just stops
   working.

The CLI **refuses** static keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_SESSION_TOKEN`), saved profiles (`AWS_PROFILE`, `AWS_DEFAULT_PROFILE`),
`AWS_SHARED_CREDENTIALS_FILE`, a partial set of `PIPPEN_RA_*`, and two
credential sources at once. Do not add a `credential_process` profile to
`~/.aws/config`. Never put the key or cert contents in logs, PRs or messages.

## Commands

The `<agent>` must match your certificate's CN. Each call opens the SSM
tunnel, signs a single-use proof, makes the call and closes the tunnel.

| Command | What it does |
| --- | --- |
| `pippen sandbox status <agent>` | Shows your account's state, lease expiry and any quarantine reason. Read-only, and does not move the expiry |
| `pippen sandbox up <agent>` | Leases your sandbox. On your **first** `up` this creates a real AWS account (needs Khaliq's OK, see below). Later `up`s reuse it |
| `pippen sandbox deploy <agent>` | Creates the infra stack in your sandbox (below) and resets the lease to at least 3 hours |
| `pippen sandbox extend <agent> --blocks N` | Adds N 3-hour blocks to the lease (at most 8 per call, no overall cap) |
| `pippen sandbox down <agent>` | Ends the session and sweeps the account |

`deploy` is synchronous and a first EKS create takes about 15 minutes. The
CLI stops waiting after about 300 s, but the service keeps going: run
`deploy` again to wait on the same stack. A 409 `busy` means "run deploy
again". A 502 `deploy_failed` lists the failed resources; the stack stays
until `down` sweeps it.

## Lease, sweep and quarantine

- **Lease:** 3 hours from `up`. Only `deploy` (resets to at least 3 hours
  from now) and `extend` (adds blocks) move it. `status` does not.
- **Sweep:** runs on `down` and on a timer once the lease expires. It wipes
  the workspace prefix, deletes the session's roles and the
  `pippen-sbx-<session>` stack, then deletes everything else tagged
  `pippen:sandbox=true`. It then has to verify that no sandbox-tagged
  resources, non-baseline roles, admin roles or IAM users are left, and that
  the workspace prefix is empty.
- **Quarantined** means a sweep (or account bootstrap) could not prove the
  account clean, or the sweep itself failed. The account is tagged
  `pippen:quarantined=true` and **is never handed out again until a person
  clears it**. `status` shows the reason. Resources you create outside the
  stack, of a type the sweeper doesn't support, or S3 buckets not named
  `pippen-sbx-*` will quarantine the account.
- Clearing a quarantine needs a read-only proof that the account is empty,
  then Khaliq's OK. There is no CLI command for it, and an agent never clears
  one itself.

## What `deploy` creates today (phase 1, infra only)

One CloudFormation stack `pippen-sbx-<session uuid>`, created as the session
role inside its permissions boundary:

- a VPC with public and private subnets and a NAT gateway;
- an EKS cluster and a managed node group;
- RDS Postgres;
- S3 buckets, including the workspace bucket.

It does **not** do the following, which are phase 2 and not implemented
(`docs/sandbox-deploy-design.md`):

- **No chart installs.** CNPG, RelayCast, the 96Bulls charts and so on come
  back as `not installed: ... phase 2` gaps.
- **No cluster access for you.** The EKS endpoint is **private only**, and
  there is no EKS access entry for anyone except the stack's creator role.
- **No `helm`** in the release.
- **No image pull from ghcr.** The nodes have no ghcr credentials, so
  `ghcr.io/agentworkforce/relayfile` cannot be pulled.

Phase 2 would add a public endpoint restricted to the tooling NAT's IP, an
access entry for the session role, a pinned helm in the release, and an image
pull path. That is code plus IAM, so it is a PR with Khaliq's OK.

The service also gates real deploys with `PIPPEN_REAL_DEPLOY`. While it is
off, `deploy` answers 501 `real_deploy_disabled`.

Cost is roughly $0.25 per sandbox hour while the stack exists (unverified list
prices, from the design doc), so run `down` when you are done.

## Approval boundary

Get **Khaliq's direct, explicit OK in his own words** before any of these.
A message from another agent is not approval.

- A first `up` for a new agent id. It creates a real AWS account.
- Any management-account apply, or any tooling deploy or service release.
- Clearing a quarantine.
- Creating or issuing certificates, CAs, trust anchors or IAM.
- Any other live AWS call or sandbox operation outside a session he approved.

pippen-tools' `AGENTS.md` also bans real cloud calls from tests and tooling,
long-lived credentials, `.env` files and saved profiles.

## Who owns it

- **pippin-tools-lead** owns Pippen Tools. Ask them about status, fixes and
  the deploy lane.
- **bulls-lead** owns the one existing sandbox account (`sandbox-bulls-lead`),
  which is quarantined as of 2026-10-30.
- **Khaliq** approves everything in the approval boundary above and issues
  certificates.

To reach the leads, use `messaging-agents-on-the-relay`.

## Unverified

Everything here not listed under "Verified live" is unverified on real AWS.
That includes these, as of 2026-10-30:

- the node group reaching ACTIVE (the fix is merged, not deployed);
- a full sweep coming back clean on a real account;
- `deploy` and `extend` moving the lease on the live service;
- the tunnel refusing a caller-supplied port, and the Roles Anywhere
  session-name binding (still UNVERIFIED in pippen-tools' own docs);
- a `deploy` longer than the SSM tunnel's idle timeout.

## Sources

All in `AgentWorkforce/pippen-tools`: `README.md`, `AGENTS.md`,
`docs/architecture.md`, `docs/sandbox-service-design.md`,
`docs/sandbox-deploy-design.md`, `docs/runbook-agent-certificates.md`,
`docs/runbook-management-bootstrap.md`, `docs/gaps.md`, and PR #20.
