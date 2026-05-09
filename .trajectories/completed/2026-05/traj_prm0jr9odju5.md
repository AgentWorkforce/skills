# Trajectory: Document repairable agent workflow gates in skills

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 9, 2026 at 11:25 AM
> **Completed:** May 9, 2026 at 11:30 AM

---

## Summary

Opened AgentWorkforce/skills PR #32 documenting repair-before-failure workflow gates in writing-agent-relay-workflows and relay-80-100-workflow, grounded in relay PRs #827 and #823.

**Approach:** Standard approach

---

## Key Decisions

### Updated workflow skills to recommend repair-before-failure gates
- **Chose:** Updated workflow skills to recommend repair-before-failure gates
- **Reasoning:** Relay PR #827 made repair-aware reliability a product contract, and PR #823 moved workflow helpers/fallback primitives toward root imports and non-fatal side effects. The skills should teach authors to route red gates to agents instead of stopping workflows.

---

## Chapters

### 1. Work
*Agent: default*

- Updated workflow skills to recommend repair-before-failure gates: Updated workflow skills to recommend repair-before-failure gates

---

## Artifacts

**Commits:** d94b5cf
**Files changed:** 2
