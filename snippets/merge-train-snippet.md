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
off, and Khaliq decides when to flip it; check that file before relying on it.
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

**Destructive changes are always manual.** A PR that the merge train's
destructive-change rule (`packages/web/lib/merge-train/destructive.ts` in
`AgentWorkforce/cloud`) flags is never merged by the train. That covers AWS
deletes or retirements, IAM, secrets, SST destructive allowlists, AWS-exit
tooling, and removed infra constructs or imports. A PR whose file list cannot
be read is held too. Khaliq approves such a PR and it is merged by hand. With
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
  maintainer's explicit approval.
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
