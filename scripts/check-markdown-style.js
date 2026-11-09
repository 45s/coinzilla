import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { findMarkdownDocuments } from "./check-agent-policy.js"
import { collectMarkdownStyleBaseline } from "./markdown-style-baseline.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

const HISTORICAL_PATHS = [
  /^apps\/harvester\/AUDIT(?:_|\.|$)/,
  /^apps\/harvester\/docs\/audits\//,
  /^apps\/harvester\/docs\/incidents\//,
  /^apps\/harvester\/docs\/tasks\//,
  /^apps\/harvester\/docs\/DDD_CLEAN_ARCHITECTURE_AUDIT\.md$/,
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

const FINDING_LABELS = Object.freeze({
  trailingWhitespace: "trailing whitespace",
  missingFinalNewline: "missing final newline",
  crlfLineEndings: "CRLF line endings",
  repeatedBlankLines: "repeated blank lines",
  missingH1: "missing H1 heading",
  multipleH1: "multiple H1 headings",
  headingLevelSkips: "skipped heading levels",
  unlabelledCodeFences: "unlabeled fenced-code blocks",
})

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path))
}

/**
 * Analyze changed maintained Markdown documents.
 *
 * Historical evidence is excluded from mechanical formatting. GitHub issue
 * and pull-request templates keep their heading conventions, while all other
 * style checks still apply to those templates.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{scannedFiles: number, skippedHistorical: number, violations: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
export function analyzeMarkdownStyleDocuments(documents) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Markdown documents must be an array")
  }

  const maintainedDocuments = documents.filter(
    ({ path }) => !matchesAny(path, HISTORICAL_PATHS),
  )
  const baseline = collectMarkdownStyleBaseline(maintainedDocuments)
  const violations = Object.fromEntries(
    Object.keys(baseline.findings).map((name) => [name, []]),
  )

  for (const [name, entries] of Object.entries(baseline.findings)) {
    const applicableEntries = HEADING_FINDINGS.has(name)
      ? entries.filter(
          ({ path }) => !matchesAny(path, TEMPLATE_HEADING_EXEMPTIONS),
        )
      : entries

    if (applicableEntries.length > 0) {
      violations[name] = applicableEntries
    }
  }

  return {
    scannedFiles: maintainedDocuments.length,
    skippedHistorical: documents.length - maintainedDocuments.length,
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

  const changedPaths = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", baseSha, "HEAD"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => /\.mdx?$/i.test(path))

  const changedPathSet = new Set(changedPaths)
  const discoveredDocuments = findMarkdownDocuments(repositoryRoot)
  const changedDocuments = discoveredDocuments.filter(({ path }) =>
    changedPathSet.has(path),
  )
  const ignoredPaths = changedPaths.length - changedDocuments.length
  const result = analyzeMarkdownStyleDocuments(changedDocuments)

  console.log(
    `Changed Markdown style: scanned ${result.scannedFiles} maintained files; skipped ${result.skippedHistorical} historical files and ${ignoredPaths} generated/vendor paths.`,
  )

  const violationEntries = Object.entries(result.violations)
  if (violationEntries.length === 0) {
    console.log("Changed maintained Markdown files satisfy the style standard.")
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

  throw new Error("Changed maintained Markdown files violate the style standard")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkChangedMarkdownStyle(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
