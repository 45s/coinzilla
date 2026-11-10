import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { findMarkdownDocuments } from "./check-agent-policy.js"
import { collectMarkdownStyleBaseline } from "./markdown-style-baseline.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

// Large release-branch diffs can exceed Node's 1 MiB execFileSync default.
export const GIT_DIFF_MAX_BUFFER_BYTES = 64 * 1024 * 1024

const HISTORICAL_PATHS = [
  /^apps\/harvester\/AUDIT(?:_|\.|$)/,
  /^apps\/harvester\/docs\/audits\//,
  /^apps\/harvester\/docs\/incidents\//,
  /^apps\/harvester\/docs\/tasks\//,
  /^apps\/harvester\/docs\/DDD_CLEAN_ARCHITECTURE_AUDIT\.md$/,
  /^apps\/harvester\/docs\/DOMAIN_FIRST_DELIVERY_PLAN\.md$/,
  /^docs\/audits\//,
  /^docs\/ai-agent\/repository-engineering-audit\.md$/,
]

const TEMPLATE_HEADING_EXEMPTIONS = [
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
]

const HEADING_FINDINGS = new Set([
  "missingH1",
  "multipleH1",
  "headingLevelSkips",
])

const FILE_LEVEL_FINDINGS = new Set([
  "missingFinalNewline",
  "crlfLineEndings",
])

const REPORT_ONLY_FINDINGS = new Set([
  "unorderedListMarkers",
  "nestedListIndentation",
  "malformedTableDelimiters",
  "tableColumnMismatches",
  "tableSpacing",
])

const FINDING_LABELS = Object.freeze({
  trailingWhitespace: "trailing whitespace",
  missingFinalNewline: "missing final newline",
  crlfLineEndings: "CRLF line endings",
  repeatedBlankLines: "repeated blank lines",
  missingH1: "missing H1 heading",
  multipleH1: "multiple H1 headings",
  headingLevelSkips: "skipped heading levels",
  unlabelledCodeFences: "unlabeled fenced-code blocks",
  listSpacing: "list blocks without blank-line separation",
})

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path))
}

/**
 * Whether a document is historical evidence excluded from changed-file enforcement.
 * @param {string} path Repository-relative path.
 * @returns {boolean}
 */
export function isHistoricalPath(path) {
  return typeof path === "string" && matchesAny(path, HISTORICAL_PATHS)
}

/**
 * Parse changed lines and new-file status from a unified Git diff.
 * Context lines are retained so nearby structural changes are checked too.
 *
 * @param {string} diffText
 * @returns {Map<string, {lines: Set<number>, isNewFile: boolean, removedHeading: boolean}>}
 */
export function parseChangedMarkdownDiff(diffText) {
  if (typeof diffText !== "string") {
    throw new TypeError("Markdown diff must be a string")
  }

  const changes = new Map()
  let currentChange = null
  let newLineNumber = 0
  let inHunk = false

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
      const path = match?.[2]
      currentChange = path && /\.mdx?$/i.test(path)
        ? { lines: new Set(), isNewFile: false, removedHeading: false }
        : null

      if (currentChange) changes.set(path, currentChange)
      inHunk = false
      continue
    }

    if (!currentChange) continue

    if (line.startsWith("new file mode ") || line === "--- /dev/null") {
      currentChange.isNewFile = true
      continue
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      newLineNumber = Number(hunk[1])
      inHunk = true
      continue
    }

    if (!inHunk || line.startsWith("\\")) continue

    if (line.startsWith("+")) {
      currentChange.lines.add(newLineNumber)
      newLineNumber += 1
      continue
    }

    if (line.startsWith(" ") ) {
      currentChange.lines.add(newLineNumber)
      newLineNumber += 1
      continue
    }

    if (line.startsWith("-")) {
      const removedLine = line.slice(1)
      if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(removedLine)) {
        currentChange.removedHeading = true
      }
    }
  }

  return changes
}

/**
 * Analyze changed maintained Markdown documents without requiring unrelated
 * pre-existing findings in the same file to be reformatted.
 *
 * Formatting findings are enforced only on changed lines and two-line
 * context. Missing final newlines and CRLF are file-level checks. New files
 * are checked in full. Historical evidence is excluded, and GitHub templates
 * retain their heading conventions while all other style checks still apply.
 *
 * @param {{path: string, content: string}[]} documents
 * @param {Map<string, {lines: Set<number>, isNewFile: boolean, removedHeading?: boolean}>} changesByPath
 * @returns {{scannedFiles: number, skippedHistorical: number, violations: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
export function analyzeMarkdownStyleDocuments(documents, changesByPath) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Markdown documents must be an array")
  }
  if (!(changesByPath instanceof Map)) {
    throw new TypeError("Changed Markdown file metadata must be a Map")
  }

  const selectedDocuments = documents.filter(({ path }) =>
    changesByPath.has(path),
  )
  const maintainedDocuments = selectedDocuments.filter(
    ({ path }) => !isHistoricalPath(path),
  )
  const baseline = collectMarkdownStyleBaseline(maintainedDocuments)
  const documentsByPath = new Map(
    maintainedDocuments.map((document) => [document.path, document]),
  )
  const violations = Object.fromEntries(
    Object.keys(baseline.findings).map((name) => [name, []]),
  )

  for (const [name, entries] of Object.entries(baseline.findings)) {
    if (REPORT_ONLY_FINDINGS.has(name)) continue
    for (const entry of entries) {
      const change = changesByPath.get(entry.path)
      const document = documentsByPath.get(entry.path)
      if (!change || !document) continue

      if (
        HEADING_FINDINGS.has(name) &&
        matchesAny(entry.path, TEMPLATE_HEADING_EXEMPTIONS)
      ) {
        continue
      }

      let isRelevant = false

      if (FILE_LEVEL_FINDINGS.has(name)) {
        isRelevant = true
      } else if (change.isNewFile) {
        isRelevant = true
      } else if (name === "missingH1") {
        const lines = document.content.split(/\r?\n/)
        const changedHeading = [...change.lines].some((lineNumber) =>
          /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(lines[lineNumber - 1] ?? ""),
        )
        isRelevant = Boolean(change.removedHeading || changedHeading)
      } else if (name === "multipleH1") {
        isRelevant = Boolean(change.removedHeading) || entry.lines.some((lineNumber) =>
          change.lines.has(lineNumber),
        )
      } else if (name === "headingLevelSkips") {
        isRelevant = Boolean(change.removedHeading) || entry.lines.some((lineNumber) =>
          [lineNumber, lineNumber - 1, lineNumber - 2].some((candidate) =>
            change.lines.has(candidate),
          ),
        )
      } else if (name === "repeatedBlankLines") {
        isRelevant = entry.lines.some((lineNumber) =>
          change.lines.has(lineNumber) || change.lines.has(lineNumber - 1),
        )
      } else {
        isRelevant = entry.lines.some((lineNumber) =>
          change.lines.has(lineNumber),
        )
      }

      if (isRelevant) violations[name].push(entry)
    }
  }

  return {
    scannedFiles: maintainedDocuments.length,
    skippedHistorical: selectedDocuments.length - maintainedDocuments.length,
    violations,
  }
}

/**
 * Check only Markdown/MDX paths changed between the exact PR base and checkout.
 *
 * @param {string} baseSha
 */
export function checkChangedMarkdownStyle(baseSha) {
  if (!/^[a-f0-9]{40}$/i.test(baseSha ?? "")) {
    throw new TypeError("A 40-character PR base commit SHA is required")
  }

  const diffText = execFileSync(
    "git",
    [
      "diff",
      "--unified=2",
      "--no-ext-diff",
      "--find-renames",
      "--diff-filter=ACMR",
      baseSha,
      "HEAD",
      "--",
      "*.md",
      "*.mdx",
    ],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES },
  )
  const changesByPath = parseChangedMarkdownDiff(diffText)
  const discoveredDocuments = findMarkdownDocuments(repositoryRoot)
  const changedDocuments = discoveredDocuments.filter(({ path }) =>
    changesByPath.has(path),
  )
  const ignoredPaths = changesByPath.size - changedDocuments.length
  const result = analyzeMarkdownStyleDocuments(changedDocuments, changesByPath)

  console.log(
    `Changed Markdown style: scanned ${result.scannedFiles} maintained files; skipped ${result.skippedHistorical} historical files and ${ignoredPaths} generated/vendor paths.`,
  )

  const violationEntries = Object.entries(result.violations).filter(
    ([, entries]) => entries.length > 0,
  )
  if (violationEntries.length === 0) {
    console.log("Changed maintained Markdown lines satisfy the style standard.")
    return result
  }

  for (const [name, entries] of violationEntries) {
    for (const entry of entries) {
      const lineDetail = entry.lines.length > 0
        ? ` (lines ${entry.lines.join(", ")})`
        : ""
      console.error(
        `- ${entry.path}: ${FINDING_LABELS[name]}${lineDetail}`,
      )
    }
  }

  throw new Error("Changed maintained Markdown lines violate the style standard")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkChangedMarkdownStyle(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
