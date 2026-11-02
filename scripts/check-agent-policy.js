import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const domainAreas = ['apps', 'packages'];

export function findInstructionDirectories(root) {
  const directories = [];

  function visit(directory, relativeDirectory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'AGENTS.md')) {
      directories.push(relativeDirectory);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
      visit(join(directory, entry.name), `${relativeDirectory}/${entry.name}`);
    }
  }

  for (const area of domainAreas) visit(join(root, area), area);
  return directories.sort();
}

function extractMappedPaths(document, suffix) {
  const expression = new RegExp('`((?:apps|packages)/[^ `]+?)' + suffix + '`', 'g');
  return [...document.matchAll(expression)].map((match) => match[1]).sort();
}

function comparePathMaps(actualDirectories, mappedDirectories, documentName) {
  const gaps = [];
  const actual = new Set(actualDirectories);
  const counts = new Map();

  for (const directory of mappedDirectories) counts.set(directory, (counts.get(directory) ?? 0) + 1);

  for (const directory of actual) {
    if (!counts.has(directory)) gaps.push(`${directory} missing from ${documentName}`);
    if ((counts.get(directory) ?? 0) > 1) gaps.push(`${directory} appears more than once in ${documentName}`);
  }

  for (const directory of counts.keys()) {
    if (!actual.has(directory)) gaps.push(`${directory} in ${documentName} has no matching AGENTS.md`);
  }

  return gaps;
}

export function findOwnershipGaps(directories, ownershipDocument, workflowDocument) {
  return [
    ...comparePathMaps(directories, extractMappedPaths(ownershipDocument, '/'), 'DOMAIN_OWNERSHIP.md'),
    ...comparePathMaps(directories, extractMappedPaths(workflowDocument, '/\\*\\*'), 'AI_AGENT_WORKFLOW.md'),
  ];
}


/**
 * Find broken relative Markdown links in the repository's central policy documents.
 * External URLs, mail links, and same-document anchors are intentionally ignored.
 *
 * @param {string} root Repository root.
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable link errors.
 */
export function findMissingLocalLinks(root, documents) {
  const gaps = [];

  for (const document of documents) {
    const links = document.content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);

    for (const match of links) {
      const target = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;

      const relativeTarget = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      if (!relativeTarget) continue;

      const absoluteTarget = resolve(root, dirname(document.path), relativeTarget);
      if (!existsSync(absoluteTarget)) {
        gaps.push(`${document.path} links to missing path ${target}`);
      }
    }
  }

  return gaps.sort();
}

/**
 * Ensure every top-level domain in the ownership map has its own roadmap.
 *
 * @param {string} root Repository root.
 * @param {string} ownershipDocument Domain ownership Markdown.
 * @returns {string[]} Missing roadmap errors.
 */
export function findMissingRoadmaps(root, ownershipDocument) {
  return extractMappedPaths(ownershipDocument, '/')
    .filter((directory) => !existsSync(join(root, directory, 'ROADMAP.md')))
    .map((directory) => `${directory} is missing ROADMAP.md`);
}

function main() {
  const directories = findInstructionDirectories(repositoryRoot);
  const ownershipDocument = readFileSync(join(repositoryRoot, 'docs/engineering/DOMAIN_OWNERSHIP.md'), 'utf8');
  const workflowDocument = readFileSync(join(repositoryRoot, 'AI_AGENT_WORKFLOW.md'), 'utf8');
  const policyPaths = [
    'AGENTS.md',
    'AI_AGENT_WORKFLOW.md',
    'ENGINEERING_STANDARDS.md',
    'docs/engineering/TASK_WORKFLOWS.md',
    'docs/engineering/DOMAIN_OWNERSHIP.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
  ];
  const policyDocuments = policyPaths.map((path) => ({
    path,
    content: readFileSync(join(repositoryRoot, path), 'utf8'),
  }));
  const gaps = [
    ...findOwnershipGaps(directories, ownershipDocument, workflowDocument),
    ...findMissingRoadmaps(repositoryRoot, ownershipDocument),
    ...findMissingLocalLinks(repositoryRoot, policyDocuments),
  ];

  if (gaps.length > 0) {
    console.error('Agent policy ownership check failed:');
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Agent policy check passed (${directories.length} domain instruction files; ownership maps, domain roadmaps, and central policy links are valid).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
