import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import process from "node:process"

import { findMarkdownDocuments } from "./check-agent-policy.js"
import {
  isHistoricalPath,
  isTemplateHeadingExempt as isTemplateHeadingPathExempt,
} from "./markdown-path-policy.js"
import { collectMarkdownStyleBaseline } from "./markdown-style-baseline.js"

export {
  classifyMarkdownPath,
  isHistoricalPath,
  isTemplateHeadingExempt,
} from "./markdown-path-policy.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

// Large release-branch diffs can exceed Node's 1 MiB execFileSync default.
export const GIT_DIFF_MAX_BUFFER_BYTES = 64 * 1024 * 1024

const HEADING_FINDINGS = new Set([
  "missingH1",
  "multipleH1",
  "headingLevelSkips",
])

const FILE_LEVEL_FINDINGS = new Set([
  "missingFinalNewline",
  "crlfLineEndings",
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
  unorderedListMarkers: "non-hyphen unordered-list markers",
  nestedListIndentation: "misaligned nested-list indentation",
  malformedTableDelimiters: "malformed table delimiters",
  tableColumnMismatches: "table column-count mismatches",
  tableSpacing: "tables without blank-line separation",
})

function createMarkdownDiffChange() {
  return {
    lines: new Set(),
    isNewFile: false,
    removedHeading: false,
  }
}

function findMarkdownDiffPath(line) {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
  const path = match?.[2]
  return path && /\.mdx?$/i.test(path) ? path : null
}

function parseMarkdownDiffLine({ line, state }) {
  if (line.startsWith("diff --git ")) {
    const path = findMarkdownDiffPath(line)
    state.currentChange = path ? createMarkdownDiffChange() : null
    if (path) {
      state.changes.set(path, state.currentChange)
    }
    state.inHunk = false
    return
  }

  if (!state.currentChange) {
    return
  }

  if (line.startsWith("new file mode ") || line === "--- /dev/null") {
    state.currentChange.isNewFile = true
    return
  }

  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
  if (hunk) {
    state.newLineNumber = Number(hunk[1])
    state.inHunk = true
    return
  }

  if (!state.inHunk || line.startsWith("\\")) {
    return
  }

  if (line.startsWith("+") || line.startsWith(" ")) {
    state.currentChange.lines.add(state.newLineNumber)
    state.newLineNumber += 1
    return
  }

  if (line.startsWith("-")) {
    const removedLine = line.slice(1)
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(removedLine)) {
      state.currentChange.removedHeading = true
    }
  }
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

  const state = {
    changes: new Map(),
    currentChange: null,
    newLineNumber: 0,
    inHunk: false,
  }
  for (const line of diffText.split("\n")) {
    parseMarkdownDiffLine({
      line,
      state,
    })
  }
  return state.changes
}

function isHeadingFindingExempt({ name, path }) {
  return HEADING_FINDINGS.has(name) && isTemplateHeadingPathExempt(path)
}

function isChangedMarkdownFindingRelevant({ name, entry, change, document }) {
  if (isHeadingFindingExempt({
    name,
    path: entry.path,
  })) {
    return false
  }
  if (FILE_LEVEL_FINDINGS.has(name) || change.isNewFile) {
    return true
  }
  if (name === "missingH1") {
    const lines = document.content.split(/\r?\n/)
    const changedHeading = [...change.lines].some((lineNumber) =>
      /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(lines[lineNumber - 1] ?? ""),
    )
    return Boolean(change.removedHeading || changedHeading)
  }
  if (name === "multipleH1") {
    return Boolean(change.removedHeading) || entry.lines.some((lineNumber) =>
      change.lines.has(lineNumber),
    )
  }
  if (name === "headingLevelSkips") {
    return Boolean(change.removedHeading) || entry.lines.some((lineNumber) =>
      [lineNumber, lineNumber - 1, lineNumber - 2].some((candidate) =>
        change.lines.has(candidate),
      ),
    )
  }
  if (name === "repeatedBlankLines") {
    return entry.lines.some((lineNumber) =>
      change.lines.has(lineNumber) || change.lines.has(lineNumber - 1),
    )
  }
  return entry.lines.some((lineNumber) => change.lines.has(lineNumber))
}

function collectChangedMarkdownStyleViolations({ baseline, changesByPath, documentsByPath }) {
  const violations = Object.fromEntries(
    Object.keys(baseline.findings).map((name) => [name, []]),
  )
  for (const [name, entries] of Object.entries(baseline.findings)) {
    for (const entry of entries) {
      const change = changesByPath.get(entry.path)
      const document = documentsByPath.get(entry.path)
      if (!change || !document) {
        continue
      }
      if (isChangedMarkdownFindingRelevant({
        name,
        entry,
        change,
        document,
      })) {
        violations[name].push(entry)
      }
    }
  }
  return violations
}

/**
 * Analyze every maintained Markdown/MDX document as a complete file.
 *
 * Historical evidence is excluded and GitHub templates retain heading-only
 * exemptions; all other style findings are blocking.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{scannedFiles: number, skippedHistorical: number, violations: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
export function analyzeFullTreeMarkdownStyle({ documents }) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Markdown documents must be an array")
  }

  const changesByPath = new Map(
    documents.map(({ path }) => [
      path,
      {
        lines: new Set(),
        isNewFile: true,
        removedHeading: false,
      },
    ]),
  )
  return analyzeMarkdownStyleDocuments({ documents, changesByPath })
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
export function analyzeMarkdownStyleDocuments({ documents, changesByPath }) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Markdown documents must be an array")
  }
  if (!(changesByPath instanceof Map)) {
    throw new TypeError("Changed Markdown file metadata must be a Map")
  }

  const selectedDocuments = documents.filter(({ path }) => changesByPath.has(path))
  const maintainedDocuments = selectedDocuments.filter(({ path }) => !isHistoricalPath(path))
  const baseline = collectMarkdownStyleBaseline(maintainedDocuments)
  const documentsByPath = new Map(maintainedDocuments.map((document) => [document.path, document]))
  const violations = collectChangedMarkdownStyleViolations({
    baseline,
    changesByPath,
    documentsByPath,
  })

  return {
    scannedFiles: maintainedDocuments.length,
    skippedHistorical: selectedDocuments.length - maintainedDocuments.length,
    violations,
  }
}

/**
 * Enforce the complete maintained Markdown/MDX tree.
 *
 * @returns {ReturnType<typeof analyzeFullTreeMarkdownStyle>}
 */
export function checkFullTreeMarkdownStyle() {
  const documents = findMarkdownDocuments(repositoryRoot)
  const result = analyzeFullTreeMarkdownStyle({ documents })
  const violationEntries = Object.entries(result.violations).filter(
    ([, entries]) => entries.length > 0,
  )

  process.stdout.write(
    `Full-tree Markdown style: scanned ${result.scannedFiles} maintained files; skipped ${result.skippedHistorical} historical files.\n`,
  )

  if (violationEntries.length === 0) {
    process.stdout.write("All maintained Markdown files satisfy the style standard.\n")
    return result
  }

  for (const [name, entries] of violationEntries) {
    for (const entry of entries) {
      const lineDetail = entry.lines.length > 0
        ? ` (lines ${entry.lines.join(", ")})`
        : ""
      process.stderr.write(
        `- ${entry.path}: ${FINDING_LABELS[name]}${lineDetail}\n`,
      )
    }
  }

  throw new Error("Full-tree maintained Markdown files violate the style standard")
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
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
    },
  )
  const changesByPath = parseChangedMarkdownDiff(diffText)
  const discoveredDocuments = findMarkdownDocuments(repositoryRoot)
  const changedDocuments = discoveredDocuments.filter(({ path }) =>
    changesByPath.has(path),
  )
  const ignoredPaths = changesByPath.size - changedDocuments.length
  const result = analyzeMarkdownStyleDocuments({
    documents: changedDocuments,
    changesByPath,
  })

  process.stdout.write(
    `Changed Markdown style: scanned ${result.scannedFiles} maintained files; skipped ${result.skippedHistorical} historical files and ${ignoredPaths} generated/vendor paths.\n`,
  )

  const violationEntries = Object.entries(result.violations).filter(
    ([, entries]) => entries.length > 0,
  )
  if (violationEntries.length === 0) {
    process.stdout.write("Changed maintained Markdown lines satisfy the style standard.\n")
    return result
  }

  for (const [name, entries] of violationEntries) {
    for (const entry of entries) {
      const lineDetail = entry.lines.length > 0
        ? ` (lines ${entry.lines.join(", ")})`
        : ""
      process.stderr.write(
        `- ${entry.path}: ${FINDING_LABELS[name]}${lineDetail}\n`,
      )
    }
  }

  throw new Error("Changed maintained Markdown lines violate the style standard")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--all-maintained") {
      checkFullTreeMarkdownStyle()
    } else {
      checkChangedMarkdownStyle(process.argv[2])
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
