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

  function visit(...args) {
    const [directory, relativeDirectory] = args;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredMarkdownDirectories.has(entry.name)) {continue;}
        visit(
          join(directory, entry.name),
          relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
        );
        continue;
      }

      if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) {continue;}
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      documents.push({ path,
content: readFileSync(join(directory, entry.name), 'utf8') });
    }
  }

  visit(root, '');
  return documents.sort((...args) => {
    const [left, right] = args;
    return left.path.localeCompare(right.path);
  });
}

/**
 * Ensure canonical documentation entry points remain present.
 *
 * @param {string} root Repository root.
 * @param {string[]} requiredPaths Required relative paths.
 * @returns {string[]} Missing-document errors.
 */
export function findMissingRequiredDocuments(...args) {
  const [root, requiredPaths] = args;
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
      activeFence = { character: fence[1][0],
length: fence[1].length };
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

  function visit(...args) {
    const [directory, relativeDirectory] = args;
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'AGENTS.md')) {
      directories.push(relativeDirectory);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') {continue;}
      visit(join(directory, entry.name), `${relativeDirectory}/${entry.name}`);
    }
  }

  for (const area of domainAreas) {visit(join(root, area), area);}
  return directories.sort();
}

function extractMappedPaths(...args) {
  const [document, suffix] = args;
  const expression = new RegExp(`\`((?:apps|packages)/[^ \`]+?)${  suffix  }\``, 'g');
  return [...document.matchAll(expression)].map((match) => match[1]).sort();
}

function comparePathMaps(...args) {
  const [actualDirectories, mappedDirectories, documentName] = args;
  const gaps = [];
  const actual = new Set(actualDirectories);
  const counts = new Map();

  for (const directory of mappedDirectories) {counts.set(directory, (counts.get(directory) ?? 0) + 1);}

  for (const directory of actual) {
    if (!counts.has(directory)) {gaps.push(`${directory} missing from ${documentName}`);}
    if ((counts.get(directory) ?? 0) > 1) {gaps.push(`${directory} appears more than once in ${documentName}`);}
  }

  for (const directory of counts.keys()) {
    if (!actual.has(directory)) {gaps.push(`${directory} in ${documentName} has no matching AGENTS.md`);}
  }

  return gaps;
}

export function findOwnershipGaps(...args) {
  const [directories, ownershipDocument] = args;
  return comparePathMaps(directories, extractMappedPaths(ownershipDocument, '/'), 'DOMAIN_OWNERSHIP.md');
}


/**
 * Find broken relative Markdown links in all discovered repository Markdown/MDX documents.
 * Inline links and reference definitions are checked; code examples and HTML comments are ignored.
 * External URLs, mail links, and same-document anchors are intentionally ignored.
 *
 * @param {string} root Repository root.
 * @param {{ path: string, content: string }[]} documents Documents to inspect.
 * @returns {string[]} Human-readable link errors.
 */
export function findMissingLocalLinks(...args) {
  const [root, documents] = args;
  const gaps = [];

  for (const document of documents) {
    for (const target of extractMarkdownLinkDestinations(document.content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) {continue;}

      const [rawPath] = target.split(/[?#]/, 1);
      if (!rawPath) {continue;}

      let relativeTarget;
      try {
        relativeTarget = decodeURIComponent(rawPath);
      } catch {
        gaps.push(`${document.path  } has malformed URL-encoded local link path "${  rawPath  }"`);
        continue;
      }

      const absoluteTarget = resolve(root, dirname(document.path), relativeTarget);
      if (!existsSync(absoluteTarget)) {
        gaps.push(`${document.path  } links to missing path ${  target}`);
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
function addMarkdownHeadingAnchor({ rawHeading, anchors, inlineCodePattern }) {
  if (/[{}]/.test(rawHeading)) {return}

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
    .replace(/&nbsp;/gi, ' ')

  const baseSlug = plainText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, '')
    .trim()
    .replace(/ /g, '-')
  if (!baseSlug) {return}

  let slug = baseSlug
  let suffix = 0
  while (anchors.has(slug)) {
    suffix += 1
    slug = `${baseSlug}-${suffix}`
  }
  anchors.add(slug)
}

function prepareMarkdownHeadingLine({ line, index, state, fencePattern }) {
  let normalizedLine = line

  if (state.inFrontMatter) {
    if (index > 0 && line.trim() === '---') {state.inFrontMatter = false}
    return {
      line: normalizedLine,
      skip: true,
    }
  }

  if (state.inHtmlComment) {
    if (line.includes('-->')) {state.inHtmlComment = false}
    return {
      line: normalizedLine,
      skip: true,
    }
  }

  if (line.includes('<!--')) {
    if (!line.includes('-->')) {
      state.inHtmlComment = true
      return {
      line: normalizedLine,
      skip: true,
    }
    }
    normalizedLine = line.replace(/<!--.*?-->/g, '')
  }

  const fenceMatch = normalizedLine.match(fencePattern)
  if (state.activeFence) {
    const isClosingFence = fenceMatch &&
      fenceMatch[1][0] === state.activeFence.character &&
      fenceMatch[1].length >= state.activeFence.length &&
      /^[ \t]*$/.test(fenceMatch[2])
    if (isClosingFence) {state.activeFence = null}
    return {
      line: normalizedLine,
      skip: true,
    }
  }

  if (fenceMatch) {
    state.activeFence = {
      character: fenceMatch[1][0],
      length: fenceMatch[1].length,
    }
    return {
      line: normalizedLine,
      skip: true,
    }
  }

  return { line: normalizedLine, skip: false }
}

function collectMarkdownHeadingAnchors(content) {
  const anchors = new Set()
  const lines = content.split(/\r?\n/)
  const codeCharacter = String.fromCharCode(96)
  const fencePattern = new RegExp(`^ {0,3}(${codeCharacter}{3,}|~{3,})(.*)$`)
  const inlineCodePattern = new RegExp(`${codeCharacter}+([^${codeCharacter}]*?)${codeCharacter}+`, 'g')
  const explicitIdPattern = /\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
  const state = {
    activeFence: null,
    inHtmlComment: false,
    inFrontMatter: lines[0]?.trim() === '---',
  }

  for (let index = 0; index < lines.length; index += 1) {
    const preparedLine = prepareMarkdownHeadingLine({
      line: lines[index],
      index,
      state,
      fencePattern,
    })
    if (preparedLine.skip) {continue}

    for (const match of preparedLine.line.matchAll(explicitIdPattern)) {
      const identifier = match[1] ?? match[2] ?? match[3]
      if (identifier) {anchors.add(identifier)}
    }

    const atxHeading = preparedLine.line.match(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/)
    if (atxHeading) {
      addMarkdownHeadingAnchor({
        rawHeading: atxHeading[1].replace(/[ \t]+#+[ \t]*$/, ''),
        anchors,
        inlineCodePattern,
      })
      continue
    }

    if (/^ {0,3}(=+|-+)[ \t]*$/.test(preparedLine.line) && index > 0) {
      const setextHeading = lines[index - 1].trim()
      if (setextHeading && !setextHeading.startsWith('>') && !setextHeading.startsWith('|')) {
        addMarkdownHeadingAnchor({
          rawHeading: setextHeading,
          anchors,
          inlineCodePattern,
        })
      }
    }
  }

  return anchors
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
export function findMissingLocalAnchors(...args) {
  const [root, documents] = args;
  const gaps = [];
  const documentsByAbsolutePath = new Map(
    documents.map((document) => [resolve(root, document.path), document]),
  );
  const anchorCache = new Map();

  for (const document of documents) {
    for (const target of extractMarkdownLinkDestinations(document.content)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) {continue;}

      const hashIndex = target.indexOf('#');
      if (hashIndex < 0) {continue;}
      const rawFragment = target.slice(hashIndex + 1);
      if (!rawFragment || rawFragment.startsWith(':~:text=')) {continue;}

      const pathAndQuery = target.slice(0, hashIndex);
      const [rawPath] = pathAndQuery.split('?', 1);
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        gaps.push(`${document.path  } has malformed URL-encoded local link path "${  rawPath  }"`);
        continue;
      }
      const absoluteTarget = decodedPath
        ? resolve(root, dirname(document.path), decodedPath)
        : resolve(root, document.path);

      if (!existsSync(absoluteTarget) || !/\.mdx?$/i.test(absoluteTarget)) {continue;}
      const targetDocument = documentsByAbsolutePath.get(absoluteTarget);
      if (!targetDocument) {continue;}

      let fragment;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        gaps.push(`${document.path  } has malformed URL-encoded heading fragment "#${  rawFragment  }"`);
        continue;
      }

      if (!anchorCache.has(absoluteTarget)) {
        anchorCache.set(absoluteTarget, collectMarkdownHeadingAnchors(targetDocument.content));
      }
      if (!anchorCache.get(absoluteTarget).has(fragment)) {
        gaps.push(`${document.path  } links to missing heading anchor "#${  fragment  }" in ${  targetDocument.path}`);
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
      if (!match) {continue;}

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

      if (isClosingFence) {activeFence = null;}
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
export function findMissingRoadmaps(...args) {
  const [root, ownershipDocument] = args;
  return extractMappedPaths(ownershipDocument, '/')
    .filter((directory) => !existsSync(join(root, directory, 'ROADMAP.md')))
    .map((directory) => `${directory} is missing ROADMAP.md`);
}


const ignoredJavaScriptDirectories = new Set([
  ...ignoredMarkdownDirectories,
  'test', 'tests', 'test-helpers',
]);

const approvedConsoleFiles = new Set([
  'packages/utils/src/logger.js',
  'packages/notifiers/scripts/telegram-smoke.js',
  'apps/harvester/scripts/list-testnet-balances.js',
  'apps/harvester/scripts/list-testnet-open-orders.js',
  'apps/harvester/scripts/list-testnet-order-history.js',
  'apps/harvester/scripts/list-testnet-trades.js',
  'apps/harvester/scripts/run-targeted-tests.js',
  'apps/harvester/scripts/sell-testnet-zro.js',
]);

/**
 * Mask JavaScript comments, strings, template text, and regular-expression
 * literals while preserving code in template interpolations and line numbers.
 *
 * @param {string} source
 * @returns {string}
 */
const REGEX_PREFIX_TOKENS = new Set([
  '=', '(', '[', '{', ',', ':', ';', '!', '?', '&&', '||', '??',
  'return', 'throw', 'case', '=>',
])
const TWO_CHARACTER_TOKENS = new Set(['=>', '&&', '||', '??'])

function blankJavaScriptSource({ output, start, end }) {
  for (let index = start; index < end; index += 1) {
    if (output[index] !== '\n' && output[index] !== '\r') {output[index] = ' '}
  }
}

function skipQuotedJavaScript({ source, output, startIndex, quote }) {
  let index = startIndex + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) {
      index += 1
      break
    }
    index += 1
  }
  blankJavaScriptSource({
    output,
    start: startIndex,
    end: index,
  })
  return index
}

function skipRegexJavaScript({ source, output, startIndex }) {
  let index = startIndex + 1
  let inCharacterClass = false
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '[') {inCharacterClass = true}
    else if (source[index] === ']') {inCharacterClass = false}
    else if (source[index] === '/' && !inCharacterClass) {
      index += 1
      while (/[a-z]/i.test(source[index] ?? '')) {index += 1}
      break
    } else if (source[index] === '\n') {
      break
    }
    index += 1
  }
  blankJavaScriptSource({
    output,
    start: startIndex,
    end: index,
  })
  return index
}

function skipLineComment({ source, output, startIndex }) {
  let index = startIndex
  while (index < source.length && source[index] !== '\n') {index += 1}
  blankJavaScriptSource({
    output,
    start: startIndex,
    end: index,
  })
  return index
}

function skipBlockComment({ source, output, startIndex }) {
  let index = startIndex + 2
  while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
    index += 1
  }
  index = Math.min(source.length, index + 2)
  blankJavaScriptSource({
    output,
    start: startIndex,
    end: index,
  })
  return index
}

function scanJavaScriptTemplate({ source, output, startIndex }) {
  let index = startIndex
  let segmentStart = index - 1
  blankJavaScriptSource({
    output,
    start: segmentStart,
    end: index,
  })
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === String.fromCharCode(96)) {
      blankJavaScriptSource({
        output,
        start: segmentStart,
        end: index + 1,
      })
      return index + 1
    }
    if (source[index] === '$' && source[index + 1] === '{') {
      blankJavaScriptSource({
        output,
        start: segmentStart,
        end: index + 2,
      })
      index = scanJavaScriptCode({
        source,
        output,
        startIndex: index + 2,
        stopAtTemplateBrace: true,
      })
      segmentStart = index
      continue
    }
    index += 1
  }
  blankJavaScriptSource({
    output,
    start: segmentStart,
    end: index,
  })
  return index
}

function readJavaScriptIdentifier({ source, startIndex }) {
  let index = startIndex + 1
  while (/[A-Za-z0-9_$]/.test(source[index] ?? '')) {index += 1}
  return {
    token: source.slice(startIndex, index),
    nextIndex: index,
  }
}

function isRegexStart({ character, previousToken }) {
  return character === '/' && (
    previousToken === '' || REGEX_PREFIX_TOKENS.has(previousToken)
  )
}

function scanJavaScriptNonCodeToken({
  source,
  output,
  index,
  character,
  next,
  previousToken,
}) {
  if (character === "'" || character === '"') {
    return {
      nextIndex: skipQuotedJavaScript({
        source,
        output,
        startIndex: index,
        quote: character,
      }),
      previousToken: 'value',
    }
  }
  if (character === String.fromCharCode(96)) {
    return {
      nextIndex: scanJavaScriptTemplate({
        source,
        output,
        startIndex: index + 1,
      }),
      previousToken: 'value',
    }
  }
  if (character === '/' && next === '/') {
    return {
      nextIndex: skipLineComment({
        source,
        output,
        startIndex: index,
      }),
    }
  }
  if (character === '/' && next === '*') {
    return {
      nextIndex: skipBlockComment({
        source,
        output,
        startIndex: index,
      }),
    }
  }
  if (isRegexStart({ character, previousToken })) {
    return {
      nextIndex: skipRegexJavaScript({
        source,
        output,
        startIndex: index,
      }),
      previousToken: 'value',
    }
  }
  return null
}

function scanJavaScriptCode({ source, output, startIndex, stopAtTemplateBrace = false }) {
  let index = startIndex
  let nestedBraces = 0
  let previousToken = ''

  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]

    if (stopAtTemplateBrace && character === '}') {
      if (nestedBraces === 0) {
        blankJavaScriptSource({
          output,
          start: index,
          end: index + 1,
        })
        return index + 1
      }
      nestedBraces -= 1
    } else if (stopAtTemplateBrace && character === '{') {
      nestedBraces += 1
    }

    const nonCodeToken = scanJavaScriptNonCodeToken({
      source,
      output,
      index,
      character,
      next,
      previousToken,
    })
    if (nonCodeToken) {
      index = nonCodeToken.nextIndex
      if (nonCodeToken.previousToken) {
        previousToken = nonCodeToken.previousToken
      }
      continue
    }

    const pair = source.slice(index, index + 2)
    if (TWO_CHARACTER_TOKENS.has(pair)) {
      previousToken = pair
      index += 2
      continue
    }

    if (/[A-Za-z_$]/.test(character)) {
      const identifier = readJavaScriptIdentifier({
        source,
        startIndex: index,
      })
      previousToken = identifier.token
      index = identifier.nextIndex
      continue
    }

    if (!/\s/.test(character)) {previousToken = character}
    index += 1
  }

  return index
}

function maskJavaScriptNonCode(source) {
  const output = source.split('')
  scanJavaScriptCode({
    source,
    output,
    startIndex: 0,
  })
  return output.join('')
}

/**
 * Discover production JavaScript files in application/package domains.
 * Tests and generated/vendor directories are excluded; explicit CLI and
 * logger-boundary exceptions are handled by findDirectConsoleUsages.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function findJavaScriptFiles(root) {
  const files = [];

  function visit(...args) {
    const [directory, relativeDirectory] = args;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredJavaScriptDirectories.has(entry.name)) {continue;}
        visit(
          join(directory, entry.name),
          relativeDirectory ? `${relativeDirectory  }/${  entry.name}` : entry.name,
        );
        continue;
      }
      if (!entry.isFile() || !/\.(?:js|mjs|cjs)$/i.test(entry.name)) {continue;}
      if (/\.(?:test|spec)\.(?:js|mjs|cjs)$/i.test(entry.name)) {continue;}
      const path = relativeDirectory ? `${relativeDirectory  }/${  entry.name}` : entry.name;
      files.push(path);
    }
  }

  for (const area of domainAreas) {
    const directory = join(root, area);
    if (existsSync(directory)) {visit(directory, area);}
  }
  return files.sort();
}

/**
 * Reject direct global console access from application/package production code.
 *
 * @param {string} root
 * @returns {string[]} Actionable source-location errors.
 */
export function findDirectConsoleUsages(root) {
  const gaps = [];
  const expression = /\bconsole\b/g;

  for (const path of findJavaScriptFiles(root)) {
    if (approvedConsoleFiles.has(path)) {continue;}
    const source = readFileSync(join(root, path), 'utf8');
    const code = maskJavaScriptNonCode(source);
    for (const match of code.matchAll(expression)) {
      const line = code.slice(0, match.index).split('\n').length;
      gaps.push(
        `${path  }:${  line  }: direct global console references are not allowed; use Logger/defaultLogger from @coinzilla/utils or add a narrowly justified CLI exception`,
      );
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
  process.stdout.write(
    `Markdown heading-anchor baseline (report-only): ${  anchorGaps.length 
    } unresolved local anchors across ${  markdownDocuments.length  } Markdown/MDX files.\n`,
  );
  for (const gap of anchorGaps) {
    process.stdout.write(`- ${  gap}\n`);
  }

  const gaps = [...new Set([
    ...findOwnershipGaps(directories, ownershipDocument),
    ...findMissingRoadmaps(repositoryRoot, ownershipDocument),
    ...findMissingRequiredDocuments(repositoryRoot, requiredDocumentationPaths),
    ...findUnbalancedMarkdownFences(markdownDocuments),
    ...findMissingLocalLinks(repositoryRoot, markdownDocuments),
    ...findDirectConsoleUsages(repositoryRoot),
  ])];

  if (gaps.length > 0) {
    process.stderr.write('Agent policy check failed:\n');
    for (const gap of gaps) {
      process.stderr.write(`- ${  gap}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Agent policy check passed (${directories.length} domain instruction files; ${markdownDocuments.length} Markdown/MDX files; ownership maps, roadmaps, required entry points, balanced Markdown fences, inline/reference-style local paths, and application/package console boundaries are valid; heading anchors are report-only).\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {main();}
