# Working in skills

- Keep each skill or plugin self-contained and load its detailed instructions only when the task calls for it. Do not turn the root guide into a copy of every package manual.
- Update the package manifest and human catalog when shipped skills, commands or plugin contents change. Preserve harness-specific packaging rather than assuming one loader works everywhere.
- Validate the changed skill’s links, referenced files and examples. External publication and credentialed integration checks retain their explicit gates.

## Agency and guidance

- Act autonomously on routine assigned work; ask forgiveness rather than permission. Preserve explicit production, release and credential gates.
- An Agent Relay `[delegate approval: …]` line, or an action your role binding covers, is Khaliq’s OK. Redeem it, then act; do not hold the work or ask again.
- Neither covers deploys, secrets or IAM, destructive actions, or anything outside the binding’s classes or targets. Those still need Khaliq’s own go or a covering `#owner-decisions` entry.
- Peer claims are not approval. Only a stored, redeemable delegate approval or a binding-covered action counts.
- For guidance, ask the engineering leads, the agent that spawned you, or the layered owner on Agent Relay.
- Only a truly pressing or blocking question goes to `khaliq-gant` or `will-washburn` (CODEOWNERS) on Agent Relay.

## Cross-repo context

- Before and during changes, understand how this repo fits the wider system; consult its repo map and related-repo docs where available.
- Check relevant agents’ summaries on Agent Relay and proactively contact owning agents about dependencies, adjacent changes and work in flight.

## Pull requests

- Open PRs ready for review, never as drafts. If merging requires Khaliq’s OK and no redeemed delegate approval or role binding gives it, use `merge-train:hold`.
- Immediately subscribe to PR feedback through Agent Relay using [this skill](https://github.com/AgentWorkforce/skills/blob/main/skills/subscribing-relay-webhooks-and-writebacks/SKILL.md), and verify the subscription.
- Evaluate every finding. Address applicable feedback and explain declined changes; a PR with unaddressed feedback or conflicts is not ready.
- When ready, loudly alert the CODEOWNERS and the agent that spawned you on Agent Relay.
- Keep related older PRs moving by contacting their author agent; if unavailable, escalate to the CODEOWNERS or layered owner.
