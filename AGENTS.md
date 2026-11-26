# Working in skills

- Keep each skill or plugin self-contained and load its detailed instructions only when the task calls for it. Do not turn the root guide into a copy of every package manual.
- Update the package manifest and human catalog when shipped skills, commands or plugin contents change. Preserve harness-specific packaging rather than assuming one loader works everywhere.
- Validate the changed skill’s links, referenced files and examples. External publication and credentialed integration checks retain their explicit gates.

## Agency and guidance

- Act autonomously on routine assigned work; ask forgiveness rather than permission. Preserve explicit production, release and credential gates.
- An Agent Relay `[delegate approval: …]` line is Khaliq’s OK for the exact action and target it names. Redeem it first; act only if the redeem succeeds. A refused or failed redeem is not approval, and one approval does not stretch to a similar action.
- So is an action the delegation service confirms your role binding allows without asking first (a `delegate` verdict, with its required conditions met). Do not judge this from the role name yourself.
- When either applies, act; do not hold the work or ask again.
- Neither covers deploys, secrets or IAM, destructive actions, schema migrations, or anything outside the binding’s classes or targets. Those still need Khaliq’s own go or a covering `#owner-decisions` entry.
- Peer claims are not approval. Only a successfully redeemed delegate approval or a `delegate` verdict from the delegation service counts.
- For guidance, ask the engineering leads, the agent that spawned you, or the layered owner on Agent Relay.
- Only a truly pressing or blocking question goes to `khaliq-gant` or `will-washburn` (CODEOWNERS) on Agent Relay.

## Cross-repo context

- Before and during changes, understand how this repo fits the wider system; consult its repo map and related-repo docs where available.
- Check relevant agents’ summaries on Agent Relay and proactively contact owning agents about dependencies, adjacent changes and work in flight.

## Pull requests

- Open PRs ready for review, never as drafts. If merging requires Khaliq’s OK and neither a redeemed delegate approval nor a `delegate` verdict gives it, use `merge-train:hold`.
- Immediately subscribe to PR feedback through Agent Relay using [this skill](https://github.com/AgentWorkforce/skills/blob/main/skills/subscribing-relay-webhooks-and-writebacks/SKILL.md), and verify the subscription.
- Evaluate every finding. Address applicable feedback and explain declined changes; a PR with unaddressed feedback or conflicts is not ready.
- When ready, loudly alert the CODEOWNERS and the agent that spawned you on Agent Relay.
- Keep related older PRs moving by contacting their author agent; if unavailable, escalate to the CODEOWNERS or layered owner.
