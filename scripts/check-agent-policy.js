import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const domainAreas = ['apps', 'packages'];

const ignoredMarkdownDirectories = new Set([
  '.git', 'node_modules', '.pnpm-store', '.cache', '.turbo', '.next',
  'coverage', 'dist', 'build', 'vendor', 'tmp',
]);

/**
 * Discover all repository Markdown/MDX files, excluding generated/vendor trees.
 *
 * @param {string} root Repository root.
 * @returns {{ path: string, content: string }[]} Sorted Markdown documents.
 */
export function findMarkdownDocuments(root) {
  const documents = [];

  function visit(directory, relativeDirectory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredMarkdownDirectories.has(entry.name)) continue;
        visit(
          join(directory, entry.name),
          relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        );
        continue;
      }

      if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      documents.push({ path, content: readFileSync(join(directory, entry.name), 'utf8') });
    }
  }

  visit(root, '');
  return documents.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Ensure canonical documentation entry points remain present.
 *
 * @param {string} root Repository root.
 * @param {string[]} requiredPaths Required relative paths.
 * @returns {string[]} Missing-document errors.
 */
export function findMissingRequiredDocuments(root, requiredPaths) {
  return requiredPaths
    .filter((path) => !existsSync(join(root, path)))
    .map((path) => `Required documentation file is missing: ${path}`);
}

function removeCodeExamples(content) {
  const output = [];
  let activeFence = null;

  for (const line of content.split(/\r?\n/)) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (activeFence) {
      if (fence && fence[1][0] === activeFence.character && fence[1].length >= activeFence.length &&
          /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(line)) {
        activeFence = null;
      }
      continue;
    }
    if (fence) {
      activeFence = { character: fence[1][0], length: fence[1].length };
      continue;
    }
    output.push(line);
  }

  return output.join('\n').replace(/(`+)[\s\S]*?\1/g, '');
}
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

export function findOwnershipGaps(directories, ownershipDocument) {
  return comparePathMaps(directories, extractMappedPaths(ownershipDocument, '/'), 'DOMAIN_OWNERSHIP.md');
}


/**
 * Find broken relative Markdown links in all discovered repository Markdown/MDX documents.
 * External URLs, mail links, and same-document anchors are intentionally ignored.
 *
 * @param {string} root Repository root.
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable link errors.
 */
export function findMissingLocalLinks(root, documents) {
  const gaps = [];

  for (const document of documents) {
    const content = removeCodeExamples(document.content);
    const links = content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);

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
 * Find unclosed fenced code blocks in repository Markdown/MDX documents.
 *
 * Fences may use backticks or tildes, with a closing fence of the same
 * character and at least the opening fence length.
 *
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable Markdown structure errors.
 */
export function findUnbalancedMarkdownFences(documents) {
  const gaps = [];

  for (const document of documents) {
    let activeFence = null;
    const lines = document.content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!match) continue;

      if (!activeFence) {
        activeFence = {
          character: match[1][0],
          length: match[1].length,
          line: index + 1,
        };
        continue;
      }

      const isClosingFence = match[1][0] === activeFence.character &&
        match[1].length >= activeFence.length &&
        /^[ \t]*$/.test(match[2]);

      if (isClosingFence) activeFence = null;
    }

    if (activeFence) {
      gaps.push(
        `${document.path} has an unclosed ${activeFence.character.repeat(activeFence.length)} fence opened at line ${activeFence.line}`,
      );
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
  const requiredDocumentationPaths = [
    'AGENTS.md',
    'AI_AGENT_WORKFLOW.md',
    'ENGINEERING_STANDARDS.md',
    'docs/DOCUMENTATION_GOVERNANCE.md',
    'docs/README.md',
    'apps/harvester/AGENTS.md',
    'apps/harvester/README.md',
    'apps/harvester/docs/README.md',
  ];
  const markdownDocuments = findMarkdownDocuments(repositoryRoot);
  const gaps = [
    ...findOwnershipGaps(directories, ownershipDocument),
    ...findMissingRoadmaps(repositoryRoot, ownershipDocument),
    ...findMissingRequiredDocuments(repositoryRoot, requiredDocumentationPaths),
    ...findUnbalancedMarkdownFences(markdownDocuments),
    ...findMissingLocalLinks(repositoryRoot, markdownDocuments),
  ];

  if (gaps.length > 0) {
    console.error('Agent policy ownership check failed:');
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Agent policy check passed (${directories.length} domain instruction files; ${markdownDocuments.length} Markdown/MDX files; ownership maps, roadmaps, required entry points, balanced Markdown fences and local links are valid).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
