## Merging: `trunk` + the `mergeable` label

CI suites do **not** run automatically on feature branches. They run only on
this repository's `trunk` → `main` pull request and on pushes to `main`. The
one check that does run on a feature PR into `main` is `Trunk guard`, which
fails it on purpose; manually dispatched workflows (`workflow_dispatch`) still
run on any branch. (Repos whose default branch is not
`main`, e.g. `master`, use that branch wherever this says `main`.) A merge
agent batches ready PRs into `trunk`, gets that one PR green, and merges it.

**When you open a PR**
1. Branch from `trunk` and open the PR with **base `trunk`**, not `main`.
   A PR into `main` from any other branch fails the `Trunk guard` check.
2. No CI runs on your PR, so verify locally before calling it ready: run the
   typecheck, tests and lint this repo uses, and list the exact commands and
   results in the PR body.
3. If the repo has numbered migrations, re-derive the migration floor (the
   highest number on `trunk`) right before pushing. Renumber a migration? Push
   the renumbered branch immediately; an unpushed reservation is invisible to
   every check.

**When the PR is ready**
4. Add the label **`mergeable`** once all of these are true:
   - The change is complete and the local checks above pass.
   - Review feedback (human and bot) is addressed or answered.
   - It is not a draft and does not depend on an unmerged PR.
5. Remove `mergeable` if the PR stops being ready (new work, a failing check, a
   blocking question). The label is read live from GitHub on every sweep.

**What you must not do**
- Do not merge your own PR, and never merge into or push to `trunk` or `main`
  directly.
- Do not re-enable CI for feature branches or edit the `trunk` gates in
  `.github/workflows/`.
- Never add `mergeable` to a PR you did not author, or to any PR from an
  external contributor (anyone outside the org without write access, including
  fork PRs), without a human maintainer's explicit approval. The merge train
  does not merge an external PR without a maintainer's APPROVED review on its
  exact head and `mergeable` added by a maintainer after the last push.

**The merge agent** sweeps open `mergeable` PRs with base `trunk` about every
10 minutes. It reads each PR's linked sessions (the `Agent Relay sessions`
block in the PR body, then the session summary) for context, merges them into
`trunk`, opens or updates the `trunk` → `main` PR, fixes CI there, merges when
green, and posts a summary. If your PR conflicts with `trunk`, it may ask you
to rebase on `trunk`; do so and keep the label.
