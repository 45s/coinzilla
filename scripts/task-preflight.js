import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureBuildMetadata } from '../packages/utils/src/index.js';

export const REQUIRED_INSTRUCTION_PATHS = ['AGENTS.md','docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md','ENGINEERING_STANDARDS.md','AI_AGENT_WORKFLOW.md','docs/engineering/TASK_WORKFLOWS.md','docs/DOCUMENTATION_GOVERNANCE.md','docs/MARKDOWN_STYLE.md'];
export const REQUIRED_ISSUE_SECTIONS = ['Problem','Expected behavior','Investigation','Possible solutions','Implementation plan','Acceptance criteria','Verification','Resolution'];
const START = '<!-- coinzilla-agent-preflight:v1 -->';
const END = '<!-- /coinzilla-agent-preflight -->';
const REQUIRED_PREFLIGHT_ENTRIES = [
  '- [x] Root AGENTS.md read',
  '- [x] AI task compliance standard read',
  '- [x] Engineering standards read',
  '- [x] AI agent workflow read',
  '- [x] Applicable task workflow read',
  '- [x] Documentation governance read',
  '- [x] Markdown style standard read',
  '- [x] Applicable nested instructions identified and read',
];
const IGNORE = new Set(['.git','node_modules','.pnpm-store','coverage','dist','build','.next','.turbo']);

export function calculateGitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${  bytes.length  }\0`).update(bytes).digest('hex');
}
export function discoverApplicableInstructionPaths({ paths, targets }) {
  return paths.filter((path) => {
    if (path === 'AGENTS.md') {return true;}
    const directory = dirname(path).replaceAll('\\', '/');
    return targets.some((targetPath) => {
      const target = targetPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
      return target === directory || target.startsWith(`${directory  }/`) || directory.startsWith(`${target  }/`);
    });
  }).sort();
}
export function parsePreflightReport(body) {
  if (typeof body !== 'string' || !body.includes(START) || !body.includes(END)) {throw new Error('Versioned preflight report missing.');}
  const block = body.slice(body.indexOf(START), body.indexOf(END));
  const issue = block.match(/^Task issue:\s*#(\d+)\s*$/m);
  const commit = block.match(/^Preflight commit:\s*\x60?([0-9a-f]{40})\x60?\s*$/im);
  const status = block.match(/^Status:\s*(\w+)\s*$/m);
  const scope = block.match(/^Task scope paths:\s*(.+)\s*$/m);
  if (!issue || !commit || !status || !scope) {
    throw new Error('Preflight report missing issue, commit SHA, scope, or status.');
  }
  const scopePaths = [...new Set(scope[1].split(',').map((path) => path.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean))];
  if (!scopePaths.length || scopePaths.some((path) => path.startsWith('/') || /^[a-z]:\//i.test(path) || path.split('/').includes('..'))) {
    throw new Error('Preflight report contains invalid task scope paths.');
  }
  for (const entry of REQUIRED_PREFLIGHT_ENTRIES) {
    if (!block.includes(entry)) {throw new Error(`Required preflight entry missing: ${  entry}`);}
  }
  const instructions = [...block.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gim)]
    .map((match) => ({
      path: match[1].replaceAll('\x60', '').trim(),
      sha: match[2].replaceAll('\x60', '').trim().toLowerCase(),
    }))
    .filter((item) => item.path !== 'Instruction file' && /^[0-9a-f]{40}$/.test(item.sha));
  if (new Set(instructions.map((item) => item.path)).size !== instructions.length) {
    throw new Error('Preflight report contains duplicate instruction paths.');
  }
  return { issueNumber: Number(issue[1]),
commitSha: commit[1].toLowerCase(),
status: status[1].toUpperCase(),
scopePaths,
instructions };
}
export function validateInstructionSnapshot({ report, actual, required }) {
  const errors = [];
  const recorded = new Map(report.instructions.map((item) => [item.path, item.sha]));
  for (const path of [...new Set(required)].sort()) {
    if (!recorded.has(path)) {errors.push(`Required instruction missing from report: ${  path}`);}
    else if (!actual.has(path)) {errors.push(`Required instruction file missing: ${  path}`);}
    else if (recorded.get(path) !== actual.get(path)) {errors.push(`Instruction hash is stale: ${  path}`);}
  }
  for (const path of recorded.keys()) {
    if (!actual.has(path)) {errors.push(`Recorded instruction no longer exists: ${  path}`);}
  }
  return errors;
}
function plain(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(?:What\b|Describe\b|List\b|Record\b|Which\b|Who\b|How\b|Summarize\b|Complete when resolved\b).*$/gim, '')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*(?:Observable outcome:?|TBD|TODO)?\s*$/gim, '')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*(?:Regression test reproduces the original defect and passes after the fix\.|Relevant failure and boundary cases are covered\.|No existing behavior or invariant regresses\.)\s*$/gim, '')
    .replace(/\b(?:TBD|TODO)\b/gi, '')
    .replace(/[\x60*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function hasConcreteAcceptanceCriteria(section) {
  const vague = /\b(?:works? as expected|works? correctly|implemented correctly|implemented as requested|all tests pass|no issues remain)\b/i;
  const criteria = section.split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => plain(line).replace(/^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean);
  return criteria.length > 0 && criteria.every((criterion) => criterion.length >= 24 && !vague.test(criterion));
}
export function validateIssueBody(body) {
  if (typeof body !== 'string' || !body.trim()) {return ['Issue body is empty.'];}
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  const sections = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.index ?? body.length;
    sections.set(heading[1].toLowerCase(), body.slice(heading.index + heading[0].length, end));
  }
  const errors = [];
  for (const name of REQUIRED_ISSUE_SECTIONS) {
    const section = sections.get(name.toLowerCase());
    if (!section) {
      errors.push(`Required issue section missing: ${name}`);
    } else if (plain(section).length < 12 || /^(?:tbd|todo|n\/a|none|pending|not started)[.! ]*$/i.test(plain(section))) {
      errors.push(`Issue section has no meaningful content: ${name}`);
    } else if (name === 'Acceptance criteria' && !hasConcreteAcceptanceCriteria(section)) {
      errors.push('Acceptance criteria must contain concrete, observable list items.');
    }
  }
  return errors;
}
function isPathWithinScope({ changedPath, scopePath }) {
  const path = changedPath.replaceAll('\\', '/').replace(/^\.\//, '');
  const scope = scopePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return scope === '.' || path === scope || path.startsWith(`${scope}/`);
}
export function validatePreflightReport({ report, context }) {
  if (!report || report.status !== 'COMPLETE') {return ['A COMPLETE preflight report is required.'];}
  const errors = [];
  if (report.issueNumber !== context.issueNumber) {errors.push('Preflight report references a different issue.');}
  if (!Array.isArray(report.scopePaths) || !report.scopePaths.length) {
    errors.push('Preflight report has no declared task scope paths.');
  } else {
    for (const changedPath of context.changedPaths || []) {
      if (!report.scopePaths.some((scopePath) => isPathWithinScope({
        changedPath,
        scopePath,
      }))) {
        errors.push(`Changed path is outside the declared preflight scope: ${changedPath}`);
      }
    }
  }
  errors.push(...validateInstructionSnapshot({
    report,
    actual: context.actualHashes,
    required: context.requiredPaths,
  }));
  if (!context.isAncestor) {errors.push('Preflight commit is not an ancestor of PR head.');}
  if (context.recordedBeforeImplementation !== true) {errors.push('Preflight report was not recorded before the first implementation commit.');}
  return errors;
}
export function extractTrackingIssueNumber(body) {
  const references = [...(body || '').matchAll(/#(\d+)/g)];
  const tracking = (body || '').match(/(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?|tracking issue)\s*:?\s*#(\d+)/i);
  if (references.length !== 1 || !tracking || references[0][1] !== tracking[1]) {return null;}
  return Number(tracking[1]);
}
function validateTrackingReference({ context, errors }) {
  if (extractTrackingIssueNumber(context.body) !== context.issueNumber) {
    errors.push('PR must reference exactly one valid tracking issue.');
  }
}
function validateReportedHead({ context, errors }) {
  const body = context.body.replaceAll('*', '');
  const reported = body.match(/^\s*-?\s*Final source commit:?\s*([0-9a-f]{40})\s*$/im)?.[1]?.toLowerCase();
  if (reported !== context.headSha?.toLowerCase()) {errors.push('Reported source commit does not match PR head SHA.');}
}
function getSectionContent({ body, title }) {
  const lines = body.split(/\r?\n/);
  const heading = `## ${  title.toLowerCase()}`;
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);
  if (start < 0) {return null;}
  const content = [];
  for (let index = start + 1; index < lines.length && !/^##\s+/.test(lines[index]); index += 1) {
    content.push(lines[index]);
  }
  return content.join('\n');
}
function validateDocumentationImpact({ context, errors }) {
  const docs = getSectionContent({ body: context.body,
title: 'Documentation impact' });
  if (!docs || plain(docs).length < 12) {
    errors.push('PR documentation impact is missing or empty.');
  }
  const changedDocs = (context.changedPaths || []).filter((path) => /\.mdx?$/i.test(path));
  const documentedPaths = new Set(
    (docs || '').split(/\s+/)
      .map((item) => item.replaceAll('\x60', '').replace(/^[*,-]+|[),.;]+$/g, ''))
      .filter(Boolean),
  );
  for (const path of changedDocs) {
    if (!documentedPaths.has(path)) {
      errors.push(`Changed documentation path is missing from PR documentation impact: ${  path}`);
    }
  }
  if ((context.changedPaths || []).length && changedDocs.length === 0 &&
      !/N\/A.{0,100}(?:because|reason|no documentation)/i.test(docs || '')) {
    errors.push('PR must explain why no documentation update is required.');
  }
}
function hasVerificationEvidence({ comments, headSha, workflowRunUrl }) {
  if (typeof headSha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(headSha) ||
      typeof workflowRunUrl !== 'string' ||
      !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/\d+$/i.test(workflowRunUrl)) {
    return false;
  }
  return comments.some((comment) =>
    /verification evidence/i.test(comment) &&
    /\b(?:pnpm|npm|node|git)\b/i.test(comment) &&
    comment.includes(headSha) &&
    comment.includes(workflowRunUrl),
  );
}
/**
 * Select the live pull-request snapshot only when its head still matches the event.
 *
 * @param {object} options
 * @param {object} options.eventPullRequest - Pull-request snapshot captured by GitHub Actions.
 * @param {object} options.currentPullRequest - Pull-request snapshot fetched from GitHub.
 * @returns {object} The current pull-request snapshot.
 * @throws {Error} If the pull request identity or head changed after the event.
 */
export function selectPullRequestSnapshot({ eventPullRequest, currentPullRequest }) {
  const eventHeadSha = eventPullRequest?.head?.sha;
  const currentHeadSha = currentPullRequest?.head?.sha;
  if (
    !Number.isInteger(eventPullRequest?.number) ||
    eventPullRequest.number !== currentPullRequest?.number ||
    !/^[a-f0-9]{40}$/i.test(eventHeadSha || '') ||
    eventHeadSha.toLowerCase() !== currentHeadSha?.toLowerCase()
  ) {
    throw new Error('Pull request head changed after the workflow event; BLOCKED.');
  }
  return currentPullRequest;
}

export function validatePullRequestEvidence(context) {
  const errors = [];
  if (context.issueIsPullRequest) {
    errors.push('Tracking reference is a pull request, not a GitHub issue.');
  }
  validateTrackingReference({ context,
errors });
  validateReportedHead({ context,
errors });
  validateDocumentationImpact({ context,
errors });
  errors.push(...validateIssueBody(context.issueBody));
  if (!hasVerificationEvidence({
    comments: context.issueComments || [],
    headSha: context.headSha,
    workflowRunUrl: context.workflowRunUrl,
  })) {
    errors.push('Issue lacks command-based verification evidence for the current PR head and GitHub Actions run.');
  }
  errors.push(...validatePreflightReport({
    report: context.preflightReport,
    context: {
      issueNumber: context.issueNumber,
      requiredPaths: context.requiredInstructionPaths,
      actualHashes: context.actualInstructionHashes,
      isAncestor: context.preflightCommitIsAncestor,
      recordedBeforeImplementation: context.preflightRecordedBeforeImplementation,
      changedPaths: context.changedPaths,
    },
  }));
  return errors;
}
function git(args) { return execFileSync('git',args,{encoding:'utf8',
stdio:['ignore','pipe','pipe']}); }
function workHash({ root, path }) {
  const file = join(root, path);
  return existsSync(file) ? calculateGitBlobSha(readFileSync(file, 'utf8')) : null;
}
function findAgents(root) {
  const found = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORE.has(entry.name)) {
        walk(join(directory, entry.name));
      } else if (entry.isFile() && entry.name === 'AGENTS.md') {
        found.push(relative(root, join(directory, entry.name)).split(sep).join('/'));
      }
    }
  }
  walk(root);
  return [...new Set(found)].sort();
}
function makeReport({ issue, sha, paths, hashes, scope }) {
  return [
    START, '## Agent preflight', '',
    '- [x] Root AGENTS.md read',
    '- [x] AI task compliance standard read',
    '- [x] Engineering standards read',
    '- [x] AI agent workflow read',
    '- [x] Applicable task workflow read',
    '- [x] Documentation governance read',
    '- [x] Markdown style standard read',
    '- [x] Applicable nested instructions identified and read',
    '', 'Relevant constraints:',
    '- Follow TDD and preserve existing contracts.',
    '- Keep the issue as the single source of truth.',
    '- Missing or unverifiable evidence is BLOCKED.',
    '', `Task scope paths: ${  scope.join(', ')}`,
    `Task issue: #${  issue}`,
    `Preflight commit: ${  sha}`,
    'Status: COMPLETE', '',
    '| Instruction file | Git blob SHA |',
    '| --- | --- |',
    ...paths.map((path) => `| ${  path  } | ${  hashes.get(path)  } |`),
    END,
  ].join('\n');
}
async function api({ path, token, method = 'GET', body }) {
  const response = await fetch(`https://api.github.com${  path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${  token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {throw new Error(`GitHub API BLOCKED (${  response.status  }): ${  await response.text()}`);}
  return response.status === 204 ? null : response.json();
}
async function issueData({ repo, number, token }) {
  const issue = await api({
    path: `/repos/${  repo  }/issues/${  number}`,
    token,
  });
  if (issue.pull_request || issue.state !== 'open') {
    throw new Error(`Tracking issue #${  number  } is not an open issue.`);
  }
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api({
      path: `/repos/${  repo  }/issues/${  number  }/comments?per_page=100&page=${  page}`,
      token,
    });
    comments.push(...batch);
    if (batch.length < 100) {break;}
    if (page === 10) {throw new Error('Issue comment history exceeds validator pagination limit; BLOCKED.');}
  }
  return { issue,
comments };
}

function latestReport(comments) {
  let latest = null;
  for (const comment of comments) {
    if (comment.body?.includes(START) && (!latest || comment.created_at > latest.created_at)) {latest = comment;}
  }
  return latest ? { ...parsePreflightReport(latest.body),
createdAt: latest.created_at } : null;
}
function formatTaskPreflightIdentity({ metadata, runtimeVersion }) {
  const { application, version, source } = metadata;
  return `${application} v${version} | commit ${source.commit ?? 'unknown'} | worktree ${source.workingTree ?? 'unknown'} | Node ${runtimeVersion}`;
}
export function parseArgs(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const parsed = {
    issue: 0,
    paths: [],
    version: false,
    record: false,
    pr: false,
    attestRead: false,
    attestNested: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--version') {
      parsed.version = true;
    } else if (args[index] === '--issue') {
      parsed.issue = Number(args[++index]);
    } else if (args[index] === '--paths') {
      parsed.paths = args[++index].split(',').map((path) => path.trim()).filter(Boolean);
    } else if (args[index] === '--record') {
      parsed.record = true;
    } else if (args[index] === '--pull-request') {
      parsed.pr = true;
    } else if (args[index] === '--attest-read') {
      parsed.attestRead = true;
    } else if (args[index] === '--attest-nested') {
      parsed.attestNested = true;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  return parsed;
}
async function local({ root, args, repo, token }) {
  if (!Number.isInteger(args.issue) || args.issue < 1 || !args.paths.length) {
    throw new Error('Use --issue <number> --paths <comma-separated paths> --attest-read --attest-nested [--record].');
  }
  if (!args.attestRead || !args.attestNested) {
    throw new Error('Explicit self-attestation flags are required: --attest-read --attest-nested.');
  }
  if (!token) {throw new Error('GH_TOKEN or GITHUB_TOKEN required; BLOCKED.');}
  const { issue } = await issueData({ repo,
number: args.issue,
token });
  const gaps = validateIssueBody(issue.body);
  if (gaps.length) {throw new Error(`Issue incomplete:\n- ${  gaps.join('\n- ')}`);}
  const paths = [...new Set([
    ...REQUIRED_INSTRUCTION_PATHS,
    ...discoverApplicableInstructionPaths({ paths: findAgents(root),
targets: args.paths }),
  ])].sort();
  const hashes = new Map(paths.map((path) => [path, workHash({ root,
path })]));
  const missing = paths.filter((path) => !hashes.get(path));
  if (missing.length) {throw new Error(`Instruction files missing:\n- ${  missing.join('\n- ')}`);}
  const body = makeReport({
    issue: args.issue,
    sha: git(['rev-parse', 'HEAD']).trim(),
    paths,
    hashes,
    scope: args.paths,
  }).replace('## Agent preflight', '## Agent preflight\n\nAgent self-attestation (not independently provable):');
  if (args.record) {
    await api({
      path: `/repos/${  repo  }/issues/${  args.issue  }/comments`,
      token,
      method: 'POST',
      body: { body },
    });
    process.stdout.write(`COMPLETE: preflight report recorded on #${  args.issue  }.\n`);
  } else {
    process.stdout.write(`${body  }\n\nNot recorded; rerun with --record before implementation.\n`);
  }
}
async function collectPullRequestEvidence({ repo, token, pr, issueNumber }) {
  const { issue, comments } = await issueData({ repo,
number: issueNumber,
token });
  const preflight = latestReport(comments);
  if (!preflight) {throw new Error('No versioned preflight report on issue; BLOCKED.');}
  const timing = await readPreflightTiming({ repo,
token,
pr,
preflight });
  const snapshot = await readApplicableInstructionSnapshot({ repo,
token,
pr,
preflight });
  return { issue,
comments,
preflight,
...timing,
...snapshot };
}
async function readPreflightTiming({ repo, token, pr, preflight }) {
  const ancestor = await isPreflightAncestor({
    repo,
    token,
    commitSha: preflight.commitSha,
    headSha: pr.head.sha,
  });
  const firstCommitDate = await getFirstPullRequestCommitDate({
    repo,
    token,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  });
  const recordedBeforeImplementation = Boolean(
    firstCommitDate && preflight.createdAt && Date.parse(preflight.createdAt) <= Date.parse(firstCommitDate),
  );
  return { ancestor,
recordedBeforeImplementation };
}
async function isPreflightAncestor({ repo, token, commitSha, headSha }) {
  const comparison = await api({
    path: `/repos/${  repo  }/compare/${  commitSha  }...${  headSha}`,
    token,
  });
  if (comparison.total_commits > comparison.commits.length) {
    throw new Error('Preflight ancestry comparison is truncated; BLOCKED.');
  }
  return comparison.status === 'ahead' || comparison.status === 'identical';
}
async function getFirstPullRequestCommitDate({ repo, token, baseSha, headSha }) {
  const comparison = await api({
    path: `/repos/${  repo  }/compare/${  baseSha  }...${  headSha}`,
    token,
  });
  if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
    throw new Error('PR head is not based on the current target branch; update the branch and retry.');
  }
  if (comparison.total_commits > comparison.commits.length) {
    throw new Error('PR commit comparison is truncated; preflight timing cannot be verified. BLOCKED.');
  }
  const firstCommit = comparison.commits?.[0];
  return firstCommit?.commit?.committer?.date || firstCommit?.commit?.author?.date || '';
}
async function readApplicableInstructionSnapshot({ repo, token, pr, preflight }) {
  const changed = await readChangedPullRequestPaths({ repo,
token,
number: pr.number });
  const baseAgents = await readBaseInstructionPaths({ repo,
token,
sha: pr.base.sha });
  const required = [...new Set([
    ...REQUIRED_INSTRUCTION_PATHS,
    ...discoverApplicableInstructionPaths({ paths: baseAgents,
targets: changed }),
    ...preflight.instructions.map((item) => item.path),
  ])].sort();
  const hashes = await readBaseInstructionHashes({ repo,
token,
sha: pr.base.sha,
paths: required });
  return { changed,
required,
hashes };
}
async function readChangedPullRequestPaths({ repo, token, number }) {
  const changed = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api({
      path: `/repos/${  repo  }/pulls/${  number  }/files?per_page=100&page=${  page}`,
      token,
    });
    changed.push(...batch.map((file) => file.filename));
    if (batch.length < 100) {return changed;}
  }
  throw new Error('PR changes exceed the validator pagination limit; BLOCKED.');
}
export async function readBaseInstructionPaths({ repo, token, sha, request = api }) {
  const tree = await request({
    path: `/repos/${repo}/git/trees/${sha}?recursive=1`,
    token,
  });
  if (tree?.truncated === true) {
    throw new Error('Base instruction tree is truncated; BLOCKED.');
  }
  if (!tree || typeof tree.truncated !== 'boolean' || !Array.isArray(tree.tree)) {
    throw new Error('Base instruction tree response is malformed; BLOCKED.');
  }
  if (tree.tree.some((item) => !item || typeof item.path !== 'string' || typeof item.type !== 'string')) {
    throw new Error('Base instruction tree contains malformed entries; BLOCKED.');
  }
  if (!tree.tree.some((item) => item.type === 'blob' && item.path === 'AGENTS.md')) {
    throw new Error('Base instruction tree is missing root AGENTS.md; BLOCKED.');
  }
  return tree.tree
    .filter((item) => item.type === 'blob' && (item.path === 'AGENTS.md' || item.path.endsWith('/AGENTS.md')))
    .map((item) => item.path);
}
async function readBaseInstructionHashes({ repo, token, sha, paths }) {
  const hashes = new Map();
  for (const path of paths) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    try {
      const blob = await api({ path: `/repos/${  repo  }/contents/${  encoded  }?ref=${  sha}`,
token });
      hashes.set(path, blob.sha || null);
    } catch (error) {
      if (String(error.message).includes('(404)')) {hashes.set(path, null);}
      else {throw error;}
    }
  }
  return hashes;
}
async function pullRequest({ repo, token, workflowRunUrl }) {
  if (!token || !process.env.GITHUB_EVENT_PATH) {throw new Error('GitHub token or PR event metadata unavailable; BLOCKED.');}
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const eventPullRequest = event.pull_request;
  if (!eventPullRequest?.number) {throw new Error('Validator requires pull-request event metadata; BLOCKED.');}
  const currentPullRequest = await api({
    path: `/repos/${  repo  }/pulls/${  eventPullRequest.number}`,
    token,
  });
  const pr = selectPullRequestSnapshot({
    eventPullRequest,
    currentPullRequest,
  });
  if (pr.base?.ref !== 'develop') {throw new Error('Validator requires a PR targeting develop.');}
  const issueNumber = extractTrackingIssueNumber(pr.body || '');
  if (!issueNumber) {throw new Error('PR must reference exactly one tracking issue; BLOCKED.');}
  const evidence = await collectPullRequestEvidence({ repo,
token,
pr,
issueNumber });
  const errors = validatePullRequestEvidence({
    body: pr.body || '',
    headSha: pr.head.sha,
    workflowRunUrl,
    issueNumber,
    issueBody: evidence.issue.body || '',
    issueComments: evidence.comments.map((item) => item.body || ''),
    preflightReport: evidence.preflight,
    requiredInstructionPaths: evidence.required,
    actualInstructionHashes: evidence.hashes,
    changedPaths: evidence.changed,
    issueIsPullRequest: Boolean(evidence.issue.pull_request),
    preflightCommitIsAncestor: evidence.ancestor,
    preflightRecordedBeforeImplementation: evidence.recordedBeforeImplementation,
  });
  if (errors.length) {throw new Error(`BLOCKED:\n- ${  errors.join('\n- ')}`);}
  process.stdout.write(`PASS: task evidence validated on ${  pr.head.sha  }.\n`);
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const metadata = captureBuildMetadata({
    application: 'task:preflight',
    version,
    cwd: root,
    env: {},
  });
  process.stdout.write(`${formatTaskPreflightIdentity({
    metadata,
    runtimeVersion: process.version,
  })}\n`);

  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required.');
  }
  if (args.pr) {
    const serverUrl = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    const runId = process.env.GITHUB_RUN_ID;
    const workflowRunUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : '';
    await pullRequest({
      repo,
      token,
      workflowRunUrl,
    });
  } else {
    await local({
      root,
      args,
      repo,
      token,
    });
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){main().catch(e=>{process.stderr.write(`BLOCKED: ${e.message}\n`);process.exitCode=1;});}
