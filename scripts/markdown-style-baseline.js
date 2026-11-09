import { fileURLToPath } from "node:url"
import { findMarkdownDocuments } from "./check-agent-policy.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

const FINDING_LABELS = Object.freeze({
  trailingWhitespace: "files with trailing whitespace",
  missingFinalNewline: "files without a final newline",
  crlfLineEndings: "files with CRLF line endings",
  repeatedBlankLines: "files with repeated blank lines",
  missingH1: "files without an H1 heading",
  multipleH1: "files with multiple H1 headings",
  headingLevelSkips: "files with skipped heading levels",
  unlabelledCodeFences: "files with unlabeled fenced-code blocks",
})

/**
 * Collect objective Markdown style metrics without enforcing or rewriting files.
 *
 * Fenced code content is excluded from heading analysis. A fence is considered
 * unlabeled when its opening delimiter has no info string. Findings are grouped
 * by file and include affected line numbers where applicable.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{fileCount: number, findings: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
export function collectMarkdownStyleBaseline(documents) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Markdown documents must be an array")
  }

  const findings = Object.fromEntries(
    Object.keys(FINDING_LABELS).map((name) => [name, []]),
  )

  for (const document of documents) {
    if (
      !document ||
      typeof document.path !== "string" ||
      typeof document.content !== "string"
    ) {
      throw new TypeError("Each Markdown document must include a path and string content")
    }

    const { path, content } = document
    const lines = content.split(/\r?\n/)
    const addFinding = (name, affectedLines = []) => {
      findings[name].push({
        path,
        count: Math.max(1, affectedLines.length),
        lines: affectedLines,
      })
    }

    const trailingWhitespaceLines = []
    const repeatedBlankLines = []
    const headingLevelSkips = []
    const unlabelledCodeFenceLines = []
    const h1Lines = []
    let previousHeadingLevel = 0
    let activeFence = null

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const lineNumber = index + 1

      if (/[ \t]+$/.test(line)) trailingWhitespaceLines.push(lineNumber)
      if (index > 0 && line.trim() === "" && lines[index - 1].trim() === "") {
        repeatedBlankLines.push(lineNumber)
      }

      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (activeFence) {
        const closesFence = fenceMatch &&
          fenceMatch[1][0] === activeFence.character &&
          fenceMatch[1].length >= activeFence.length &&
          /^[ \t]*$/.test(fenceMatch[2])
        if (closesFence) activeFence = null
        continue
      }

      if (fenceMatch) {
        if (fenceMatch[2].trim() === "") {
          unlabelledCodeFenceLines.push(lineNumber)
        }
        activeFence = {
          character: fenceMatch[1][0],
          length: fenceMatch[1].length,
        }
        continue
      }

      const headingMatch = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/)
      if (!headingMatch) continue

      const level = headingMatch[1].length
      if (level === 1) h1Lines.push(lineNumber)
      if (level > previousHeadingLevel + 1) {
        headingLevelSkips.push(lineNumber)
      }
      previousHeadingLevel = level
    }

    if (trailingWhitespaceLines.length > 0) {
      addFinding("trailingWhitespace", trailingWhitespaceLines)
    }
    if (!content.endsWith("\n")) addFinding("missingFinalNewline")
    if (content.includes("\r\n")) addFinding("crlfLineEndings")
    if (repeatedBlankLines.length > 0) {
      addFinding("repeatedBlankLines", repeatedBlankLines)
    }
    if (h1Lines.length === 0) addFinding("missingH1")
    if (h1Lines.length > 1) addFinding("multipleH1", h1Lines)
    if (headingLevelSkips.length > 0) {
      addFinding("headingLevelSkips", headingLevelSkips)
    }
    if (unlabelledCodeFenceLines.length > 0) {
      addFinding("unlabelledCodeFences", unlabelledCodeFenceLines)
    }
  }

  return { fileCount: documents.length, findings }
}

/**
 * Print the baseline for all repository Markdown/MDX documents.
 * Existing findings are informational and never fail this command.
 */
export function reportMarkdownStyleBaseline() {
  const documents = findMarkdownDocuments(repositoryRoot)
  const report = collectMarkdownStyleBaseline(documents)
  console.log(
    `Markdown style baseline (report-only): ${report.fileCount} files; no findings are enforced.`,
  )

  for (const [name, entries] of Object.entries(report.findings)) {
    const total = entries.reduce((sum, entry) => sum + entry.count, 0)
    console.log(`- ${FINDING_LABELS[name]}: ${entries.length} files / ${total} occurrences`)
    for (const entry of entries) {
      const lineDetail = entry.lines.length > 0
        ? ` (lines ${entry.lines.join(", ")})`
        : ""
      console.log(`  - ${entry.path}${lineDetail}`)
    }
  }

  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  reportMarkdownStyleBaseline()
}
