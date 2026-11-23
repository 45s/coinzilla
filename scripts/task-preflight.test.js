import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  REQUIRED_INSTRUCTION_PATHS,
  REQUIRED_ISSUE_SECTIONS,
  calculateGitBlobSha,
  discoverApplicableInstructionPaths,
  parseArgs,
  parsePreflightReport,
  readBaseInstructionPaths,
  validateInstructionSnapshot,
  validateIssueBody,
  validatePreflightReport,
  extractTrackingIssueNumber,
  validatePullRequestEvidence,
} from './task-preflight.js';

const CURRENT_WORKFLOW_RUN_URL = 'https://github.com/45s/coinzilla/actions/runs/123456789';
function buildIssueBody({
  acceptanceCriteria = '- [ ] The validator rejects stale instruction hashes.',
  sectionContent = 'Specific evidence for',
} = {}) {
  return REQUIRED_ISSUE_SECTIONS.map((heading) => {
    const content = heading === 'Acceptance criteria'
      ? acceptanceCriteria
      : `${sectionContent} ${heading.toLowerCase()}.`;
    return `## ${heading}\n\n${content}`;
  }).join('\n\n');
}

test('requires the canonical repository instruction set', () => {
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('AGENTS.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('ENGINEERING_STANDARDS.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('AI_AGENT_WORKFLOW.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('docs/engineering/TASK_WORKFLOWS.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('docs/DOCUMENTATION_GOVERNANCE.md'));
  assert.ok(REQUIRED_INSTRUCTION_PATHS.includes('docs/MARKDOWN_STYLE.md'));
});

test('parses pnpm separator and PR-mode arguments', () => {
  assert.deepEqual(parseArgs(['--', '--pull-request']), {
    issue: 0,
    paths: [],
    version: false,
    record: false,
    pr: true,
    attestRead: false,
    attestNested: false,
  });
});

test('parses local preflight arguments and explicit attestations', () => {
  assert.deepEqual(parseArgs([
    '--issue', '1754',
    '--paths', 'scripts,docs/engineering',
    '--attest-read',
    '--attest-nested',
    '--record',
  ]), {
    issue: 1754,
    paths: ['scripts', 'docs/engineering'],
    version: false,
    record: true,
    pr: false,
    attestRead: true,
    attestNested: true,
  });
});

test('calculates Git blob SHA rather than hashing raw file bytes', () => {
  assert.equal(calculateGitBlobSha('test\n'), '9daeafb9864cf43055ae93beb0afd6c7d144bfa4');
});

test('discovers nested AGENTS instructions applicable to changed paths', () => {
  const paths = [
    'AGENTS.md',
    'apps/harvester/AGENTS.md',
    'apps/harvester/src/AGENTS.md',
    'packages/brokers/AGENTS.md',
  ];
  assert.deepEqual(
    discoverApplicableInstructionPaths({ paths,
targets: ['apps/harvester/src/domain/decision.js'] }),
    ['AGENTS.md', 'apps/harvester/AGENTS.md', 'apps/harvester/src/AGENTS.md'],
  );
});

test('parses a versioned preflight report with instruction hashes and commit identity', () => {
  const source = [
    '<!-- coinzilla-agent-preflight:v1 -->',
    '## Agent preflight',
    '- [x] Root AGENTS.md read',
    '- [x] AI task compliance standard read',
    '- [x] Engineering standards read',
    '- [x] AI agent workflow read',
    '- [x] Applicable task workflow read',
    '- [x] Documentation governance read',
    '- [x] Markdown style standard read',
    '- [x] Applicable nested instructions identified and read',
    'Task scope paths: scripts, docs/engineering',
    'Task issue: #1754',
    'Preflight commit: \x600123456789012345678901234567890123456789\x60',
    'Status: COMPLETE',
    '| Instruction file | Git blob SHA |',
    '| --- | --- |',
    '| \x60AGENTS.md\x60 | \x600123456789012345678901234567890123456789\x60 |',
    '<!-- /coinzilla-agent-preflight -->',
  ];
  const report = parsePreflightReport(source.join('\n'));
  assert.equal(report.issueNumber, 1754);
  assert.equal(report.commitSha, '0123456789012345678901234567890123456789');
  assert.equal(report.status, 'COMPLETE');
  assert.deepEqual(report.scopePaths, ['scripts', 'docs/engineering']);
  assert.deepEqual(report.instructions, [{
    path: 'AGENTS.md',
    sha: '0123456789012345678901234567890123456789',
  }]);
  assert.throws(
    () => parsePreflightReport(source.join('\n').replace('- [x] Root AGENTS.md read', '- [ ] Root AGENTS.md read')),
    /Required preflight entry missing/,
  );
});
test('rejects malformed or incomplete preflight reports', () => {
  assert.throws(() => parsePreflightReport('Status: COMPLETE'), /preflight report/i);
  assert.throws(() => parsePreflightReport([
    '<!-- coinzilla-agent-preflight:v1 -->',
    'Task issue: #1754',
    'Preflight commit: not-a-sha',
    'Status: COMPLETE',
    '<!-- /coinzilla-agent-preflight -->',
  ].join('\n')), /commit SHA/i);
});

test('detects missing and stale instruction hashes', () => {
  const report = {
    instructions: [
      { path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { path: 'ENGINEERING_STANDARDS.md',
sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    ],
  };
  const actual = new Map([
    ['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['ENGINEERING_STANDARDS.md', 'cccccccccccccccccccccccccccccccccccccccc'],
  ]);

  assert.deepEqual(validateInstructionSnapshot({ report,
actual,
required: ['AGENTS.md', 'ENGINEERING_STANDARDS.md'] }), [
    'Instruction hash is stale: ENGINEERING_STANDARDS.md',
  ]);
  assert.deepEqual(validateInstructionSnapshot({ report,
actual,
required: [
    'AGENTS.md',
    'ENGINEERING_STANDARDS.md',
    'docs/engineering/TASK_WORKFLOWS.md',
  ] }), [
    'Instruction hash is stale: ENGINEERING_STANDARDS.md',
    'Required instruction missing from report: docs/engineering/TASK_WORKFLOWS.md',
  ]);
});

test('requires meaningful content in all eight issue sections', () => {
  const body = buildIssueBody({ sectionContent: 'Documented details for' });
  assert.deepEqual(validateIssueBody(body), []);
  assert.ok(validateIssueBody(body.replace('Documented details for verification.', 'TBD')).some((error) => /Verification/.test(error)));
  assert.ok(validateIssueBody(body.replace('## Possible solutions', '## Options').replace('Documented details for possible solutions.', '')).length > 0);
});


test('rejects untouched template prompts instead of treating them as issue evidence', () => {
  const template = REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${heading}\n\nWhat should happen? Describe the actual details here.`).join('\n\n');
  assert.ok(validateIssueBody(template).length >= REQUIRED_ISSUE_SECTIONS.length);
});

test('validates preflight report issue, status, required hashes, and ancestry', () => {
  const report = {
    issueNumber: 1754,
    commitSha: '0123456789012345678901234567890123456789',
    status: 'COMPLETE',
    scopePaths: ['scripts'],
    instructions: [{ path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  };
  assert.deepEqual(validatePreflightReport({ report,
context: {
    issueNumber: 1754,
    requiredPaths: ['AGENTS.md'],
    actualHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    isAncestor: true,
    recordedBeforeImplementation: true,
    changedPaths: ['scripts/task-preflight.test.js'],
  } }), []);
  assert.ok(validatePreflightReport({ report,
context: {
    issueNumber: 1755,
    requiredPaths: ['AGENTS.md'],
    actualHashes: new Map([['AGENTS.md', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']]),
    isAncestor: false,
    recordedBeforeImplementation: false,
  } }).length >= 4);
});


test('blocks documentation paths omitted from the PR impact statement', () => {
  const errors = validatePullRequestEvidence({
    body: 'Fixes #1754\n\nFinal source commit: 0123456789012345678901234567890123456789\n\n## Documentation impact\nUpdated: docs/README.md',
    headSha: '0123456789012345678901234567890123456789',
    issueNumber: 1754,
    issueBody: buildIssueBody(),
    issueComments: [`Verification evidence: pnpm run test:task-preflight on commit 0123456789012345678901234567890123456789; CI run: ${CURRENT_WORKFLOW_RUN_URL}`],
    workflowRunUrl: CURRENT_WORKFLOW_RUN_URL,
    changedPaths: ['README.md'],
    preflightReport: {
      issueNumber: 1754,
      scopePaths: ['.'],
      status: 'COMPLETE',
      instructions: [{ path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
  });
  assert.ok(errors.some((error) => error.includes('README.md')));
});

test('extracts exactly one valid same-repository tracking issue from a PR body', () => {
  assert.equal(extractTrackingIssueNumber('Fixes #1754'), 1754);
  assert.equal(extractTrackingIssueNumber('No issue'), null);
  assert.equal(extractTrackingIssueNumber('Fixes #1754 and #1755'), null);
  assert.equal(extractTrackingIssueNumber('Fixes https://github.com/other/repo/issues/1754'), null);
});

test('blocks PR evidence when head SHA, acceptance, verification, or documentation disposition is missing', () => {
  const result = validatePullRequestEvidence({
    body: 'Fixes #1754\n\nFinal source commit: 0123456789012345678901234567890123456789\n\n## Documentation impact\nUpdated: docs/README.md',
    headSha: '0123456789012345678901234567890123456789',
    issueNumber: 1754,
    issueBody: buildIssueBody(),
    issueComments: [`Verification evidence: pnpm run test:task-preflight on commit 0123456789012345678901234567890123456789; CI run: ${CURRENT_WORKFLOW_RUN_URL}`],
    workflowRunUrl: CURRENT_WORKFLOW_RUN_URL,
    changedPaths: ['docs/README.md'],
    preflightReport: {
      issueNumber: 1754,
      scopePaths: ['.'],
      commitSha: '0123456789012345678901234567890123456789',
      status: 'COMPLETE',
      instructions: [{ path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
    preflightRecordedBeforeImplementation: true,
  });
  assert.deepEqual(result, []);

  const blocked = validatePullRequestEvidence({
    body: 'Fixes #1754\n\nFinal source commit: ffffffffffffffffffffffffffffffffffffffff',
    headSha: '0123456789012345678901234567890123456789',
    issueNumber: 1754,
    issueBody: '## Problem\nTBD',
    issueComments: [],
    preflightReport: null,
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map(),
    preflightCommitIsAncestor: false,
  });
  assert.ok(blocked.length >= 5);
});


test('requires verification evidence to name the exact current PR head SHA', () => {
  const headSha = '0123456789012345678901234567890123456789';
  const staleSha = 'ffffffffffffffffffffffffffffffffffffffff';
  const errors = validatePullRequestEvidence({
    body: `Fixes #1754\n\nFinal source commit: ${headSha}\n\n## Documentation impact\nN/A because this test-only change does not alter maintained documentation.`,
    headSha,
    issueNumber: 1754,
    issueBody: buildIssueBody(),
    issueComments: [`Verification evidence: pnpm run test:task-preflight on commit ${staleSha}; CI run: ${CURRENT_WORKFLOW_RUN_URL}`],
    workflowRunUrl: CURRENT_WORKFLOW_RUN_URL,
    changedPaths: ['scripts/task-preflight.test.js'],
    preflightReport: {
      issueNumber: 1754,
      scopePaths: ['.'],
      commitSha: staleSha,
      status: 'COMPLETE',
      instructions: [{
        path: 'AGENTS.md',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
    preflightRecordedBeforeImplementation: true,
  });

  assert.ok(
    errors.some((error) => /verification evidence.*current PR head/i.test(error)),
    'Verification evidence from an earlier commit must not satisfy the current PR head gate.',
  );
});


test('prints source identity and exits without GitHub credentials for --version', () => {
  const scriptPath = fileURLToPath(new URL('./task-preflight.js', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--version'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SystemRoot: process.env.SystemRoot,
      GITHUB_REPOSITORY: '',
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
    },
  });

  assert.equal(
    result.status,
    0,
    `The --version command must exit successfully without GitHub credentials; stderr: ${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /task:preflight v\d+\.\d+\.\d+/,
    'The startup identity must name the task:preflight command and owning package version.',
  );
  assert.match(
    result.stdout,
    /commit [a-f0-9]{40,64}/i,
    'The startup identity must report the full Git commit SHA from the executing checkout.',
  );
  assert.match(
    result.stdout,
    /worktree (?:clean|dirty|unknown)/,
    'The startup identity must report an explicit worktree state without exposing changed paths.',
  );
  assert.match(
    result.stdout,
    /Node v\d+\.\d+\.\d+/,
    'The startup identity must report the Node.js runtime version.',
  );
  assert.equal(
    result.stderr,
    '',
    'A successful side-effect-free --version invocation must not emit a blocked/error diagnostic.',
  );
});


test('requires verification evidence to link to the exact current GitHub Actions run', () => {
  const headSha = '0123456789012345678901234567890123456789';
  const commentRunUrl = 'https://github.com/45s/coinzilla/actions/runs/12345';
  const currentRunUrl = 'https://github.com/45s/coinzilla/actions/runs/67890';
  const errors = validatePullRequestEvidence({
    body: `Fixes #1754\n\nFinal source commit: ${headSha}\n\n## Documentation impact\nN/A because this test-only change does not alter maintained documentation.`,
    headSha,
    issueNumber: 1754,
    issueBody: buildIssueBody(),
    issueComments: [`Verification evidence: pnpm run test:task-preflight passed on commit ${headSha}; CI run: ${commentRunUrl}`],
    workflowRunUrl: currentRunUrl,
    changedPaths: ['scripts/task-preflight.test.js'],
    preflightReport: {
      issueNumber: 1754,
      scopePaths: ['.'],
      commitSha: headSha,
      status: 'COMPLETE',
      instructions: [{
        path: 'AGENTS.md',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
    preflightRecordedBeforeImplementation: true,
  });

  assert.ok(
    errors.some((error) => /current PR head and GitHub Actions run/i.test(error)),
    'A verification claim linked to another workflow run must not satisfy current-head evidence.',
  );
});

test('rejects vague or non-observable acceptance criteria', () => {
  for (const acceptanceCriteria of [
    '- [ ] Works as expected.',
    'Everything should be fine.',
    '- [ ] The feature works as expected for all supported inputs.',
  ]) {
    const errors = validateIssueBody(buildIssueBody({ acceptanceCriteria }));
    assert.ok(
      errors.some((error) => /acceptance criteria/i.test(error)),
      `Vague acceptance criteria must be rejected: ${acceptanceCriteria}`,
    );
  }
});

test('rejects changed paths outside the declared preflight scope', () => {
  const errors = validatePreflightReport({
    report: {
      issueNumber: 1754,
      status: 'COMPLETE',
      scopePaths: ['scripts'],
      instructions: [{
        path: 'AGENTS.md',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    },
    context: {
      issueNumber: 1754,
      requiredPaths: ['AGENTS.md'],
      actualHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
      isAncestor: true,
      recordedBeforeImplementation: true,
      changedPaths: ['apps/harvester/src/index.js'],
    },
  });

  assert.ok(
    errors.some((error) => /outside.*scope/i.test(error)),
    'A report scoped only to scripts must not attest to changed Harvester files.',
  );
});

test('fails closed when preflight timing cannot be verified', () => {
  const errors = validatePreflightReport({
    report: {
      issueNumber: 1754,
      status: 'COMPLETE',
      scopePaths: ['scripts'],
      instructions: [{
        path: 'AGENTS.md',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    },
    context: {
      issueNumber: 1754,
      requiredPaths: ['AGENTS.md'],
      actualHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
      isAncestor: true,
    },
  });

  assert.ok(
    errors.some((error) => /not recorded before/i.test(error)),
    'Unknown timing must fail closed instead of being treated as a valid preflight.',
  );
});

test('fails closed when the base instruction tree response is malformed', async () => {
  await assert.rejects(
    readBaseInstructionPaths({
      repo: '45s/coinzilla',
      token: 'test-token',
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      request: async () => ({ truncated: false }),
    }),
    /malformed/i,
    'A successful API response without a tree array must not silently omit nested AGENTS.md files.',
  );
});

test('rejects a pull request used as the tracking issue', () => {
  const headSha = '0123456789012345678901234567890123456789';
  const errors = validatePullRequestEvidence({
    body: `Fixes #1754\n\nFinal source commit: ${headSha}\n\n## Documentation impact\nN/A because this test-only change does not alter maintained documentation.`,
    headSha,
    issueNumber: 1754,
    issueBody: buildIssueBody(),
    issueComments: [
      `Verification evidence: pnpm run test:task-preflight on commit ${headSha}; CI run: ${CURRENT_WORKFLOW_RUN_URL}`,
    ],
    workflowRunUrl: CURRENT_WORKFLOW_RUN_URL,
    issueIsPullRequest: true,
    changedPaths: ['scripts/task-preflight.test.js'],
    preflightReport: {
      issueNumber: 1754,
      scopePaths: ['.'],
      commitSha: headSha,
      status: 'COMPLETE',
      instructions: [{
        path: 'AGENTS.md',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
    preflightRecordedBeforeImplementation: true,
  });

  assert.ok(
    errors.some((error) => /pull request.*not.*issue/i.test(error)),
    'A PR number must not satisfy the required tracking-issue reference.',
  );
});