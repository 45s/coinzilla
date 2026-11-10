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

/**
 * Remove fenced and inline code before scanning Markdown destinations.
 * @param {string} content
 * @returns {string}
 */
export function removeCodeExamples(content) {
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
/**
 * Extract destinations from Markdown inline links and reference definitions.
 * Code examples and HTML comments are excluded.
 * @param {string} content Markdown source.
 * @returns {string[]} Link destinations in source order.
 */
function extractMarkdownLinkDestinations(content) {
  const source = removeCodeExamples(content).replace(/<!--[\s\S]*?-->/g, '');
  const destinations = [];
  const inlineLinks = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  const referenceDefinitions = /^[ \t]{0,3}\[(?!\^)[^\]]+\]:[ \t]*(?:<([^>]+)>|([^\s]+))/gm;

  for (const match of source.matchAll(inlineLinks)) {
    destinations.push(match[1] || match[2]);
  }
  for (const match of source.matchAll(referenceDefinitions)) {
    destinations.push(match[1] || match[2]);
  }

  return destinations;
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
/**
 * Find broken relative Markdown links in all discovered repository Markdown/MDX documents.
 * Inline links and reference definitions are checked; code examples and HTML comments are ignored.
 * External URLs, mail links, and same-document anchors are intentionally ignored.
 *
 * @param {string} root Repository root.
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable link errors.
 */
export function findMissingLocalLinks(root, documents) {
  const gaps = [];

  for (const document of documents) {
    for (const target of extractMarkdownLinkDestinations(document.content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;

      const rawPath = target.split(/[?#]/, 1)[0];
      if (!rawPath) continue;

      let relativeTarget;
      try {
        relativeTarget = decodeURIComponent(rawPath);
      } catch {
        gaps.push(document.path + ' has malformed URL-encoded local link path "' + rawPath + '"');
        continue;
      }

      const absoluteTarget = resolve(root, dirname(document.path), relativeTarget);
      if (!existsSync(absoluteTarget)) {
        gaps.push(document.path + ' links to missing path ' + target);
      }
    }
  }

  return gaps.sort();
}

/**
 * Collect GitHub-style heading slugs and explicit HTML anchor IDs.
 *
 * @param {string} content Markdown/MDX source.
 * @returns {Set<string>} Anchor identifiers present in the document.
 */
function collectMarkdownHeadingAnchors(content) {
  const anchors = new Set();
  const lines = content.split(/\r?\n/);
  const codeCharacter = String.fromCharCode(96);
  const fencePattern = new RegExp('^ {0,3}(' + codeCharacter + '{3,}|~{3,})(.*)$');
  const inlineCodePattern = new RegExp(codeCharacter + '+([^' + codeCharacter + ']*?)' + codeCharacter + '+', 'g');
  const explicitIdPattern = /\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let activeFence = null;
  let inHtmlComment = false;
  let inFrontMatter = lines[0]?.trim() === '---';

  function addHeading(rawHeading) {
    if (/[{}]/.test(rawHeading)) return;

    const plainText = rawHeading
      .replace(/<!--.*?-->/g, '')
      .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(inlineCodePattern, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\\([#.+!?()[\]{}])/g, '$1')
      .replace(/[*~]/g, '')
      .replace(/(^|\s)_([^_]+)_($|\s)/g, '$1$2$3')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ');

    const baseSlug = plainText
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, '')
      .trim()
      .replace(/ /g, '-');
    if (!baseSlug) return;

    let slug = baseSlug;
    let suffix = 0;
    while (anchors.has(slug)) {
      suffix += 1;
      slug = baseSlug + '-' + suffix;
    }
    anchors.add(slug);
  }

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];

    if (inFrontMatter) {
      if (index > 0 && line.trim() === '---') inFrontMatter = false;
      continue;
    }

    if (inHtmlComment) {
      if (line.includes('-->')) inHtmlComment = false;
      continue;
    }

    if (line.includes('<!--')) {
      if (!line.includes('-->')) {
        inHtmlComment = true;
        continue;
      }
      line = line.replace(/<!--.*?-->/g, '');
    }

    const fenceMatch = line.match(fencePattern);
    if (activeFence) {
      const isClosingFence = fenceMatch &&
        fenceMatch[1][0] === activeFence.character &&
        fenceMatch[1].length >= activeFence.length &&
        /^[ \t]*$/.test(fenceMatch[2]);
      if (isClosingFence) activeFence = null;
      continue;
    }

    if (fenceMatch) {
      activeFence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }

    for (const match of line.matchAll(explicitIdPattern)) {
      const identifier = match[1] ?? match[2] ?? match[3];
      if (identifier) anchors.add(identifier);
    }

    const atxHeading = line.match(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/);
    if (atxHeading) {
      addHeading(atxHeading[1].replace(/[ \t]+#+[ \t]*$/, ''));
      continue;
    }

    if (/^ {0,3}(=+|-+)[ \t]*$/.test(line) && index > 0) {
      const setextHeading = lines[index - 1].trim();
      if (setextHeading && !setextHeading.startsWith('>') && !setextHeading.startsWith('|')) {
        addHeading(setextHeading);
      }
    }
  }

  return anchors;
}

/**
 * Find unresolved local Markdown heading fragments.
 *
 * External URLs, non-Markdown assets, missing target paths (reported by
 * findMissingLocalLinks), code examples and text fragments are excluded.
 * Historical documents remain included in this report-only baseline.
 *
 * @param {string} root Repository root.
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable heading-anchor errors.
 */
export function findMissingLocalAnchors(root, documents) {
  const gaps = [];
  const documentsByAbsolutePath = new Map(
    documents.map((document) => [resolve(root, document.path), document]),
  );
  const anchorCache = new Map();

  for (const document of documents) {
    for (const target of extractMarkdownLinkDestinations(document.content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;

      const hashIndex = target.indexOf('#');
      if (hashIndex < 0) continue;
      const rawFragment = target.slice(hashIndex + 1);
      if (!rawFragment || rawFragment.startsWith(':~:text=')) continue;

      const pathAndQuery = target.slice(0, hashIndex);
      const rawPath = pathAndQuery.split('?', 1)[0];
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        gaps.push(document.path + ' has malformed URL-encoded local link path "' + rawPath + '"');
        continue;
      }
      const absoluteTarget = decodedPath
        ? resolve(root, dirname(document.path), decodedPath)
        : resolve(root, document.path);

      if (!existsSync(absoluteTarget) || !/\.mdx?$/i.test(absoluteTarget)) continue;
      const targetDocument = documentsByAbsolutePath.get(absoluteTarget);
      if (!targetDocument) continue;

      let fragment;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        gaps.push(document.path + ' has malformed URL-encoded heading fragment "#' + rawFragment + '"');
        continue;
      }

      if (!anchorCache.has(absoluteTarget)) {
        anchorCache.set(absoluteTarget, collectMarkdownHeadingAnchors(targetDocument.content));
      }
      if (!anchorCache.get(absoluteTarget).has(fragment)) {
        gaps.push(document.path + ' links to missing heading anchor "#' + fragment + '" in ' + targetDocument.path);
      }
    }
  }

  return gaps.sort();
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
  const anchorGaps = findMissingLocalAnchors(repositoryRoot, markdownDocuments);
  console.log(
    'Markdown heading-anchor baseline (report-only): ' + anchorGaps.length +
    ' unresolved local anchors across ' + markdownDocuments.length + ' Markdown/MDX files.',
  );
  for (const gap of anchorGaps) console.log('- ' + gap);

  const gaps = [...new Set([
    ...findOwnershipGaps(directories, ownershipDocument),
    ...findMissingRoadmaps(repositoryRoot, ownershipDocument),
    ...findMissingRequiredDocuments(repositoryRoot, requiredDocumentationPaths),
    ...findUnbalancedMarkdownFences(markdownDocuments),
    ...findMissingLocalLinks(repositoryRoot, markdownDocuments),
  ])];

  if (gaps.length > 0) {
    console.error('Agent policy ownership check failed:');
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Agent policy check passed (${directories.length} domain instruction files; ${markdownDocuments.length} Markdown/MDX files; ownership maps, roadmaps, required entry points, balanced Markdown fences and inline/reference-style local paths are valid; heading anchors are report-only).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
