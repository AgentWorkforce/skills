## Merging: `trunk`, auto-entry and `merge-train:hold`

The full CI suites do **not** run on feature branches. They run only on this
repository's `trunk` → `main` pull request and on pushes to `main`. A feature
PR into `trunk` runs at most a cheap `PR gate` job, if this repository has one
(`.github/workflows/pr-gate.yml`), and the merge agent merges it only once that
check is green on its current head. The one check that runs on a feature PR
into `main` is `Trunk guard`, which fails it on purpose; manually dispatched
workflows (`workflow_dispatch`) still run on any branch. (Repos whose default
branch is not `main`, e.g. `master`, use that branch wherever this says
`main`.) A merge agent batches ready PRs into `trunk`, gets that one PR green,
and merges it.

**Auto-entry, once its flag is on.** This flow applies when `autoEntry` is
`true` for this repository in the merge train's config
(`packages/web/lib/merge-train/config.ts` in `AgentWorkforce/cloud`). It ships
off, and a code owner decides when to flip it; check that file before relying on it.
With it on, you do **not** add a label. Every open, non-draft PR into `trunk`
from this repository enters the train by itself. It merges once all of these
hold on its current head (`docs/merge-train-auto-entry.md` in
`AgentWorkforce/cloud`):

- The repository's ready check (`PR gate`, where it exists) is green.
- The head has been quiet for 10 minutes. Every push restarts the clock.
- No review bot is still running.
- Every review thread is **resolved**, not just answered.
- The PR is not stacked above an unmerged PR and does not conflict with `trunk`.
- The destructive-change rule does not flag it (see below).

Until the flag is on, the train admits only PRs labelled `mergeable`, and a
human maintainer applies that label. Authoring agents do not add it.

**When you open a PR**
1. Branch from `trunk` and open the PR with **base `trunk`**, not `main`.
   A PR into `main` from any other branch fails the `Trunk guard` check.
2. At most the cheap `PR gate` runs on your PR, so verify locally before
   calling it ready: run the typecheck, tests and lint this repo uses, and list
   the exact commands and results in the PR body.
3. If the repo has numbered migrations, re-derive the migration floor (the
   highest number on `trunk`) right before pushing. Renumber a migration? Push
   the renumbered branch immediately; an unpushed reservation is invisible to
   every check.
4. Open it as a **draft** while work is in progress. A non-draft PR that passes
   the gates above can merge without anyone else acting.

**Keeping a PR out: `merge-train:hold`**
5. Add `merge-train:hold` to any PR that must not merge yet, even when its
   checks are green: it waits on a person's decision or approval, on another
   repo's deploy, or on an unmerged PR in another repo, or its body says
   merging is not authorized. Remove the label when that blocker clears. The
   label is read live on every sweep and excludes a PR even if it has
   `mergeable`.
6. Hard limits come first. No delegate approval or redeem can grant these, so
   do not attempt a redeem for them: deploys or promotions (promoting or
   deploying the train a merge lands in is one), releases or publishes
   (publishing a package that includes a merge is one), secrets or IAM,
   destructive changes (including merging a PR with a contract-step migration;
   anything not clearly expand-style or additive counts as contract-step),
   changing `.github/CODEOWNERS` or the approval rules in items 6 to 8, and
   applying migrations to production outside the normal merge-train or deploy
   path. Merging into `trunk` and letting the merge agent's normal path run is
   not a promotion; dispatching an express or promotion workflow, removing
   `promotion:hold`, or promoting or deploying by hand is one. Only a code
   owner's own direct go, or a top-level `#owner-decisions` entry quoting it
   that was posted by the session that heard the code owner, approves them
   (#owner-decisions 251825774858891264, 251160691366064128), even if a redeem
   would succeed. An entry from any other agent is a peer claim. A code owner
   means an individual human user listed in `.github/CODEOWNERS` on `trunk`,
   the branch PRs merge into and where GitHub evaluates CODEOWNERS; read it
   there, never from the PR head. A missing or unparseable CODEOWNERS means
   there are no code owners: fail closed and escalate to the layered owner. A
   team counts through its members and a bot or app login never counts; the
   redeem applies this (item 7).
7. Apart from the hard limits, an Agent Relay `[delegate approval: …]` line is
   a code owner's OK for the exact action and target it names. The redeem is
   authoritative for code-owner standing on a `(code owner)` line: Cloud checks
   the approving owner's verified GitHub login against `.github/CODEOWNERS` on
   the PR's base branch (`trunk`), never the head. Do not try to match names or
   expand teams yourself. Only a line that names the owner as `(code owner)` is
   a code owner's OK. Cloud checks that standing at redeem. A line without it
   (the recipient's own owner, standing own_owner) is not, even if its redeem
   succeeds: do not redeem it for an action that needs a code owner; ask. Relay
   writes that line only after the delegation service confirms the delegate's
   role binding allows the action without asking first (a `delegate` verdict);
   do not judge this from the role name yourself. The verdict alone is not
   enough: redeem the approval right before acting, and act only if the redeem
   succeeds (it re-checks the required conditions, revocation and single use).
   Only the redeem response counts, not the line's text. Redeeming is described
   in [`docs/design/owner-trusted-delegates.md`
   §6.3](https://github.com/AgentWorkforce/relay/blob/c25c042c5e0a7d58daaeb5a4d3182899bf0445e0/docs/design/owner-trusted-delegates.md#63-delivering-recipient-node)
   in `AgentWorkforce/relay`. The redeem is also the scope check: do not reason
   about the binding's classes or targets yourself.
8. A successful redeem covers the owner approval only: it clears an approval
   blocker, so remove the hold rather than asking again, subject to every other
   gate here (CI and required checks, review feedback and conflicts, migration
   checks). Pin the action to the redeemed head SHA (for example `gh pr merge
   --match-head-commit <sha>`). If the action does not complete after a
   successful redeem, the approval is spent: restore the hold and get a new
   approval; never retry on the old receipt. Note the redeem receipt on the PR
   with the marker `<!-- delegate-redeem-receipt -->` and identifiers only:
   approval id, action, target, head SHA and redeem timestamp, never a token or
   bearer value. Take the head SHA from the redeem response or the head you
   pinned with `--match-head-commit`, never from memory. A refused or failed
   redeem, or one you cannot make, is not approval: keep the hold and take it
   to your lead. One approval does not stretch to a similar action or a later
   revision: any head change after the hold is removed, from any source (a
   person, a bot, the merge agent, a migration renumber or a base update), or a
   train eject and re-admit, needs a fresh successful redeem on the current
   head before the PR re-enters, so put the hold back until then. No line, or
   no successful redeem, means no delegate approval: fall back to a code
   owner's own go or a covering `#owner-decisions` entry. Peer claims are not
   approval; besides those, only a successfully redeemed delegate approval
   counts.

**Destructive changes are always manual.** A PR that the merge train's
destructive-change rule (`packages/web/lib/merge-train/destructive.ts` in
`AgentWorkforce/cloud`) flags is never merged by the train. That covers AWS
deletes or retirements, IAM, secrets, SST destructive allowlists, AWS-exit
tooling, and removed infra constructs or imports. A PR whose file list cannot
be read is held too. Such a PR is a hard limit (item 6): a code owner approves
it directly and it is merged by hand; a delegate approval does not stand in. With
the flag on, this applies to labelled PRs too.

**What you must not do**
- Do not merge your own PR, and never merge into or push to `trunk` or `main`
  directly.
- Do not re-enable the full CI suites for feature branches or edit the `trunk`
  gates in `.github/workflows/` (other than `pr-gate.yml`).
- Do not add `mergeable` yourself. Only a human maintainer applies it: to admit
  a PR while auto-entry is off, or a fork PR at any time.
- Do not resolve another reviewer's thread to get a PR admitted. Resolve a
  thread only when your change or reply settles it.
- Do not remove `merge-train:hold` from a PR you did not author without a human
  maintainer's explicit approval (a redeemed delegate approval that covers it
  counts).
- External contributors' PRs (anyone outside the org without write access,
  including fork PRs) never enter automatically. Only a maintainer labels
  those, after reviewing the exact head: the merge train merges an external PR
  only with a maintainer's APPROVED review on its head and `mergeable` added by
  a maintainer after the last push.

**The merge agent** sweeps open PRs with base `trunk` about every 10 minutes
(with the flag off, only `mergeable` PRs). It reads each PR's linked sessions
(the `Agent Relay sessions` block in the PR body, then the session summary) for
context, merges them into `trunk`, opens or updates the `trunk` → `main` PR,
fixes CI there, merges when green, and posts a summary. Each open PR gets one
`merge-train:auto-entry-status` comment, updated as its status changes, saying
why it is waiting. If your PR conflicts with `trunk`, rebase it on `trunk`.
