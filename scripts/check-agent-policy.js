import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const domainAreas = ['apps', 'packages'];

function findInstructionDirectories(root) {
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

function main() {
  const directories = findInstructionDirectories(repositoryRoot);
  const ownershipDocument = readFileSync(join(repositoryRoot, 'docs/engineering/DOMAIN_OWNERSHIP.md'), 'utf8');
  const workflowDocument = readFileSync(join(repositoryRoot, 'AI_AGENT_WORKFLOW.md'), 'utf8');
  const gaps = findOwnershipGaps(directories, ownershipDocument, workflowDocument);

  if (gaps.length > 0) {
    console.error('Agent policy ownership check failed:');
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Agent policy ownership check passed (${directories.length} domain instruction files; both maps are complete and unique).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
