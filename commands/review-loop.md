---
description: Run the dual-reviewer (Claude + Codex) subagent-fanned review/fix loop until both reviewers independently sign off
argument-hint: [base-ref] [--max N] [--pr N]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Review Loop

Run an extensive code-review loop on the current working-tree changes. Claude
and Codex each review independently — fanning out into their own subagents —
a Codex fixer repairs every valid finding from both reviews, and the loop
repeats with fresh agent context until **both** reviewers sign off. Harness-
agnostic: works under Claude Code, Codex, OpenCode, Droid, Gemini, or any
harness that supports markdown slash commands.

**Args:** $ARGUMENTS

## Instructions

1. **Load the skills.** Read `writing-agent-relay-workflows` and
   `review-fix-signoff-loop`. After `npx prpm install
   @agent-relay/writing-agent-relay-workflows @agent-relay/review-fix-signoff-loop`,
   look in `.claude/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md`;
   when developing inside the skills repo, read `skills/<name>/SKILL.md`. These
   document the SDK surface, the fresh-context iteration pattern, the strict
   dual-reviewer verdict contract, and blocked-state handling that this loop
   depends on. Do not improvise the loop semantics.

2. **Parse arguments from `$ARGUMENTS`:**
   - Optional positional `[base-ref]` → exported as `REVIEW_BASE`. If omitted,
     the workflow auto-detects (merge-base with `origin/main`/`main`, else
     `HEAD~1`).
   - Optional `--max N` → exported as `MAX_REVIEW_ITERATIONS` (default 5).
   - Optional `--pr N` → exported as `REVIEW_PR_NUMBER` for the printed
     signoff-comment command.

3. **Locate the workflow — pin to an immutable ref.** It ships in the
   `workflows` repo at `repeatable/review-loop/workflow.ts`. If the current
   repo does not contain it, do **not** fetch from a moving branch: pull it
   from an immutable ref so the run is deterministic and not subject to
   unreviewed behavior changes. In order of preference:
   1. an installed published package at a pinned version (e.g.
      `npx prpm install @agent-relay/review-loop@<version>`);
   2. a Git **tag** or **release**:
      `https://raw.githubusercontent.com/AgentWorkforce/workflows/<tag>/repeatable/review-loop/workflow.ts`;
   3. a specific **commit SHA** (never `main`/`HEAD`):
      `…/AgentWorkforce/workflows/<commit-sha>/repeatable/review-loop/workflow.ts`.
   If no pinned ref/version is available, ask the user which tag or commit to
   use and stop — do not silently fall back to the default branch. Record the
   exact ref used in the run summary. Never paraphrase the workflow into
   ad-hoc agent calls — run the actual file so the deterministic gates and
   fresh-context loop execute.

4. **Dry-run first.** `agent-relay run --dry-run
   repeatable/review-loop/workflow.ts` and confirm `Validation: PASS` before
   the real run. Surface any validation error verbatim and stop.

5. **Run the loop:**
   ```bash
   REVIEW_BASE=<ref> MAX_REVIEW_ITERATIONS=<n> REVIEW_PR_NUMBER=<pr> \
     agent-relay run repeatable/review-loop/workflow.ts
   ```
   Only set the env vars the user actually supplied.

6. **Report back.** Read `.workflow-artifacts/review-loop/SIGNOFF.md` and
   report: final status (`SIGNED_OFF` / `BLOCKED` / not-signed-off), iteration
   count, and the path to per-iteration `claude-review.md` / `codex-review.md`
   / `review-fix-report.md`. If `BLOCKED_NO_COMMIT.md` exists, surface its
   exact evidence and the safe retry command — do not claim success.

## Output Contract

- One-line result: final status + iterations run + dual-signoff yes/no.
- Path to `SIGNOFF.md` and the latest iteration's review/fix artifacts.
- If a PR number was supplied and the loop signed off, the exact
  `gh pr comment <pr> --body-file .workflow-artifacts/review-loop/SIGNOFF.md`
  command.

## Constraints

- Run the real workflow file — do not reimplement the loop inline.
- The loop reviews and repairs the working tree only. It does **not** commit,
  push, or open a PR; do not add that yourself unless the user asks.
- Signoff requires **both** Claude and Codex at
  `VERDICT: COMPREHENSIVELY_SATISFIED`. A single reviewer's pass is not signoff.
- Both reviewers must fan out into subagents — the workflow already mandates
  this in its task prompts; do not weaken those prompts.
- A blocked or budget-exhausted run is a non-zero outcome. Report it honestly;
  never fabricate a signoff.
