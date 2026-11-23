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
  validateInstructionSnapshot,
  validateIssueBody,
  validatePreflightReport,
  extractTrackingIssueNumber,
  validatePullRequestEvidence,
} from './task-preflight.js';

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
  const body = REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${heading}\n\nDocumented details for ${heading.toLowerCase()}.`).join('\n\n');
  assert.deepEqual(validateIssueBody(body), []);
  assert.ok(validateIssueBody(body.replace('Documented details for verification.', 'TBD')).some((error) => /Verification/.test(error)));
  assert.ok(validateIssueBody(body.replace('## Possible solutions', '## Options').replace('Documented details for possible solutions.', '')).length > 0);
});


test('rejects untouched template prompts instead of treating them as issue evidence', () => {
  const template = REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${heading}\n\nWhat should happen? Describe the actual details here.`).join('\n\n');
  assert.equal(validateIssueBody(template).length, REQUIRED_ISSUE_SECTIONS.length);
});

test('validates preflight report issue, status, required hashes, and ancestry', () => {
  const report = {
    issueNumber: 1754,
    commitSha: '0123456789012345678901234567890123456789',
    status: 'COMPLETE',
    instructions: [{ path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  };
  assert.deepEqual(validatePreflightReport({ report,
context: {
    issueNumber: 1754,
    requiredPaths: ['AGENTS.md'],
    actualHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    isAncestor: true,
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
    issueBody: REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${  heading  }\n\nSpecific evidence for ${  heading  }.`).join('\n\n'),
    issueComments: ['Verification evidence: pnpm test passed on commit 0123456789012345678901234567890123456789'],
    changedPaths: ['README.md'],
    preflightReport: {
      issueNumber: 1754,
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
    issueBody: REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${heading}\n\nEvidence for ${heading}.`).join('\n\n'),
    issueComments: ['Verification evidence: pnpm test passed on commit 0123456789012345678901234567890123456789'],
    changedPaths: ['docs/README.md'],
    preflightReport: {
      issueNumber: 1754,
      commitSha: '0123456789012345678901234567890123456789',
      status: 'COMPLETE',
      instructions: [{ path: 'AGENTS.md',
sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    },
    requiredInstructionPaths: ['AGENTS.md'],
    actualInstructionHashes: new Map([['AGENTS.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]),
    preflightCommitIsAncestor: true,
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
    issueBody: REQUIRED_ISSUE_SECTIONS.map((heading) => `## ${heading}\n\nSpecific evidence for ${heading}.`).join('\n\n'),
    issueComments: [`Verification evidence: pnpm run test:task-preflight passed on commit ${staleSha}`],
    changedPaths: ['scripts/task-preflight.test.js'],
    preflightReport: {
      issueNumber: 1754,
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
    errors.some((error) => /verification evidence.*current PR head SHA/i.test(error)),
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
    /task:preflight v\\d+\\.\\d+\\.\\d+/,
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
    /Node v\\d+\\.\\d+\\.\\d+/,
    'The startup identity must report the Node.js runtime version.',
  );
  assert.equal(
    result.stderr,
    '',
    'A successful side-effect-free --version invocation must not emit a blocked/error diagnostic.',
  );
});
