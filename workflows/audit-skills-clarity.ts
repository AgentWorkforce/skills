import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

const SKILLS_DIR = 'skills';
const CHANNEL = 'wf-audit-skills-clarity';
const REPORT_PATH = 'SKILLS_CLARITY_REPORT.md';

async function runWorkflow() {
  const result = await workflow('audit-skills-clarity')
    .description(
      'Claude and Codex discuss every SKILL.md in this repo and jointly produce a clarity audit with the top 10 improvements.',
    )
    .pattern('dag')
    .channel(CHANNEL)
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('claude-auditor', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role:
        'Clarity reviewer and synthesizer. Reads skills, debates with codex-auditor on the channel, and writes the final report.',
      retries: 1,
    })
    .agent('codex-auditor', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role:
        'Second opinion clarity reviewer. Challenges claude-auditor on the channel, proposes concrete rewrites, and signs off on the final report.',
      retries: 1,
    })

    .step('read-skills', {
      type: 'deterministic',
      command: [
        'set -e',
        `if [ ! -d ${SKILLS_DIR} ]; then echo "ERROR: ${SKILLS_DIR} not found"; exit 1; fi`,
        `echo "# ALL SKILL.md CONTENTS"`,
        `for f in ${SKILLS_DIR}/*/SKILL.md; do echo; echo "=============================="; echo "FILE: $f"; echo "=============================="; cat "$f"; done`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('claude-discuss', {
      agent: 'claude-auditor',
      dependsOn: ['read-skills'],
      task: [
        `You are claude-auditor on #${CHANNEL}. Your counterpart is codex-auditor (a Codex agent) who will join the same channel in parallel.`,
        '',
        'GOAL: Together, audit every skill below for CLARITY — how easily a new agent or engineer could read the SKILL.md and act correctly without extra context.',
        '',
        'PROCESS:',
        `1. Post a short opening message on #${CHANNEL} listing the six skills and the clarity dimensions you will evaluate (e.g. scannability, precise triggers, unambiguous rules, concrete examples, footgun coverage, recoverable-on-skim structure).`,
        '2. For each skill, post a concise clarity assessment: what is clear, what is ambiguous or buried, and one concrete rewrite suggestion.',
        '3. Read codex-auditor\'s posts on the channel. Disagree where warranted. Converge via discussion — do NOT just merge both lists.',
        '4. Once you and codex-auditor have converged, YOU (claude-auditor) write the final report to the repo as:',
        `   ${REPORT_PATH}`,
        '   The report must contain, in this order:',
        '   - A 3-5 sentence executive summary of the overall clarity state of the skills',
        '   - A per-skill paragraph (one per SKILL.md) noting the top clarity issue and strength',
        '   - A numbered section titled exactly "## Top 10 Clarity Improvements" with exactly 10 items.',
        '     Each item must have: a short title, the affected skill(s), the problem in one sentence, and a concrete proposed fix in 1-3 sentences.',
        '   - A short "## Agreement" section where you explicitly note which items codex-auditor endorsed and any remaining disagreements.',
        '5. After writing the file, post a message on #${CHANNEL} pointing codex-auditor at the file and asking for sign-off. If codex-auditor pushes back, revise the file in place.',
        '',
        'CONSTRAINTS:',
        '- Do NOT modify any SKILL.md file. This is a review only — your only write is the report.',
        '- Prefer concrete rewrites over abstract critique. Quote short snippets when useful.',
        '- The report must stand alone (a reader should understand the issues without reading the channel transcript).',
        '- Keep the top-10 list tight: each item should be actionable by one person in under an hour.',
        '',
        'CONTEXT — all six SKILL.md files are embedded below:',
        '',
        '{{steps.read-skills.output}}',
      ].join('\n'),
      verification: { type: 'file_exists', value: REPORT_PATH },
      retries: 1,
    })

    .step('codex-discuss', {
      agent: 'codex-auditor',
      dependsOn: ['read-skills'],
      task: [
        `You are codex-auditor on #${CHANNEL}. Your counterpart is claude-auditor (a Claude agent) who is joining the same channel in parallel.`,
        '',
        'GOAL: Together, audit every skill below for CLARITY. You are the second reviewer and the devil\'s advocate — your job is to prevent groupthink.',
        '',
        'PROCESS:',
        `1. Wait briefly for claude-auditor to post opening thoughts on #${CHANNEL}. Then post your own independent clarity assessment per skill.`,
        '2. Actively disagree where you see it differently. Propose alternative rewrites. Call out when claude-auditor\'s suggestion is too abstract to act on.',
        '3. When claude-auditor posts a draft of the report file at:',
        `   ${REPORT_PATH}`,
        '   READ the file from disk, evaluate whether the "Top 10" actually covers the highest-leverage clarity issues, and post either (a) sign-off or (b) specific revision requests naming item numbers.',
        '4. Keep iterating with claude-auditor until you are satisfied. Then post a final "SIGNED OFF" message on the channel.',
        '',
        'CONSTRAINTS:',
        '- You do NOT write the final report file. claude-auditor owns the file; you review it.',
        '- You may write scratch notes to /tmp if needed, but do not modify any SKILL.md.',
        '- Prefer specific, quoted critique. "Item 4 is vague — rewrite as: <proposal>" is better than "item 4 could be stronger".',
        '',
        'CONTEXT — all six SKILL.md files are embedded below:',
        '',
        '{{steps.read-skills.output}}',
      ].join('\n'),
      retries: 1,
    })

    .step('verify-report', {
      type: 'deterministic',
      dependsOn: ['claude-discuss', 'codex-discuss'],
      command: [
        'set -e',
        `if [ ! -f ${REPORT_PATH} ]; then echo "ERROR: ${REPORT_PATH} was not written"; exit 1; fi`,
        `if ! grep -qE "^## Top 10 Clarity Improvements" ${REPORT_PATH}; then echo "ERROR: missing required section"; exit 1; fi`,
        // Count numbered items (1.–10.) in the Top 10 section.
        `COUNT=$(awk '/^## Top 10 Clarity Improvements/{flag=1; next} /^## /{flag=0} flag && /^[0-9]+\\. /' ${REPORT_PATH} | wc -l | tr -d ' ')`,
        'echo "numbered items found: $COUNT"',
        'if [ "$COUNT" -lt 10 ]; then echo "ERROR: fewer than 10 improvements listed"; exit 1; fi',
        `if ! grep -qE "^## Agreement" ${REPORT_PATH}; then echo "ERROR: missing Agreement section"; exit 1; fi`,
        'echo REPORT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
