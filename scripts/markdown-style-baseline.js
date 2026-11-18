import { fileURLToPath } from "node:url"
import { findMarkdownDocuments } from "./check-agent-policy.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const INLINE_CODE_DELIMITER = String.fromCharCode(96)

const FINDING_LABELS = Object.freeze({
  trailingWhitespace: "files with trailing whitespace",
  missingFinalNewline: "files without a final newline",
  crlfLineEndings: "files with CRLF line endings",
  repeatedBlankLines: "files with repeated blank lines",
  missingH1: "files without an H1 heading",
  multipleH1: "files with multiple H1 headings",
  headingLevelSkips: "files with skipped heading levels",
  unlabelledCodeFences: "files with unlabeled fenced-code blocks",
  unorderedListMarkers: "files with non-hyphen unordered-list markers",
  nestedListIndentation: "files with nested-list items misaligned to parent content columns",
  listSpacing: "list blocks without blank-line separation",
  malformedTableDelimiters: "tables with malformed delimiter cells",
  tableColumnMismatches: "tables with inconsistent column counts",
  tableSpacing: "tables without blank-line separation",
})

function parseListItem(line) {
  const match = line.match(/^([ \t]*)([-+*]|\d+[.)])([ \t]+|$)/)
  if (!match) {return null}
  return { indent: match[1],
marker: match[2],
separator: match[3] }
}

function getIndentationWidth(line) {
  const indentation = line.match(/^([ \t]*)/)?.[1] ?? ""
  return indentation.replace(/\t/g, "    ").length
}

function isIndentedCodeLine(line) {
  return /^(?: {4,}|\t)\S/.test(line)
}

function isNestedListContent({ lines, index, indentation }) {
  let previousIndex = index - 1
  while (previousIndex >= 0 && lines[previousIndex].trim() === "") {
    previousIndex -= 1
  }

  if (previousIndex < 0) {return false}

  const parentItem = parseListItem(lines[previousIndex])
  if (!parentItem) {return false}

  const parentContentColumn = getIndentationWidth(parentItem.indent) +
    parentItem.marker.length +
    parentItem.separator.length
  return indentation === parentContentColumn
}

function collectIndentedCodeLineIndexes({ lines }) {
  const codeLineIndexes = new Set()
  let isInsideIndentedCodeBlock = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === "") {
      if (isInsideIndentedCodeBlock) {
        let nextContentIndex = index + 1
        while (
          nextContentIndex < lines.length &&
          lines[nextContentIndex].trim() === ""
        ) {
          nextContentIndex += 1
        }

        if (
          nextContentIndex < lines.length &&
          isIndentedCodeLine(lines[nextContentIndex])
        ) {
          codeLineIndexes.add(index)
        } else {
          isInsideIndentedCodeBlock = false
        }
      }
      continue
    }

    if (isInsideIndentedCodeBlock) {
      if (isIndentedCodeLine(line)) {
        codeLineIndexes.add(index)
        continue
      }
      isInsideIndentedCodeBlock = false
    }

    if (!isIndentedCodeLine(line)) {continue}

    const hasRequiredBlockSeparation = index === 0 ||
      lines[index - 1].trim() === ""
    if (!hasRequiredBlockSeparation) {continue}

    if (
      isNestedListContent({
        lines,
        index,
        indentation: getIndentationWidth(line),
      })
    ) {
      continue
    }

    codeLineIndexes.add(index)
    isInsideIndentedCodeBlock = true
  }

  return codeLineIndexes
}

function splitTableCells(line) {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) {return null}

  let source = trimmed
  if (source.startsWith("|")) {source = source.slice(1)}
  if (source.endsWith("|") && !source.endsWith("\\|")) {
    source = source.slice(0, -1)
  }

  const cells = []
  let current = ""
  let activeCodeDelimiterLength = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character === "\\" && source[index + 1] === "|") {
      current += "|"
      index += 1
      continue
    }

    if (character === INLINE_CODE_DELIMITER) {
      let delimiterLength = 1
      while (source[index + delimiterLength] === INLINE_CODE_DELIMITER) {
        delimiterLength += 1
      }
      if (activeCodeDelimiterLength === 0) {
        activeCodeDelimiterLength = delimiterLength
      } else if (activeCodeDelimiterLength === delimiterLength) {
        activeCodeDelimiterLength = 0
      }
      current += INLINE_CODE_DELIMITER.repeat(delimiterLength)
      index += delimiterLength - 1
      continue
    }

    if (character === "|" && activeCodeDelimiterLength === 0) {
      cells.push(current.trim())
      current = ""
      continue
    }

    current += character
  }

  cells.push(current.trim())
  return cells.length >= 2 ? cells : null
}

function collectListMarkerFindings({ lines, codeLineIndexes }) {
  const unorderedListMarkers = []
  const nestedListIndentation = []
  const parentStack = []

  for (let index = 0; index < lines.length; index += 1) {
    if (codeLineIndexes.has(index)) {continue}

    const item = parseListItem(lines[index])
    if (!item) {
      if (lines[index].trim() === "") {continue}
      const indentation = (lines[index].match(/^([ \t]*)/)?.[1] ?? "")
        .replace(/\t/g, "    ").length
      const parent = parentStack[parentStack.length - 1]
      if (parent && indentation >= parent.contentColumn) {continue}
      parentStack.length = 0
      continue
    }

    const lineNumber = index + 1
    if (item.marker === "*" || item.marker === "+") {
      unorderedListMarkers.push(lineNumber)
    }

    const indentWidth = item.indent.replace(/\t/g, "    ").length
    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1].indent >= indentWidth
    ) {
      parentStack.pop()
    }

    const parent = parentStack[parentStack.length - 1]
    const hasUnexpectedIndentation = item.indent.includes("\t") ||
      (indentWidth > 0 && (!parent || indentWidth !== parent.contentColumn))
    if (hasUnexpectedIndentation) {
      nestedListIndentation.push(lineNumber)
    }

    parentStack.push({
      indent: indentWidth,
      contentColumn: indentWidth + item.marker.length + item.separator.length,
    })
  }

  return {
    unorderedListMarkers,
    nestedListIndentation,
  }
}

function collectListSpacingFindings({ lines, codeLineIndexes }) {
  const listSpacing = []

  for (let index = 0; index < lines.length; index += 1) {
    if (codeLineIndexes.has(index)) {continue}

    const item = parseListItem(lines[index])
    if (!item || item.indent !== "") {continue}

    const lineNumber = index + 1
    let end = index
    let cursor = index + 1

    while (cursor < lines.length) {
      if (codeLineIndexes.has(cursor)) {break}

      if (parseListItem(lines[cursor])) {
        end = cursor
        cursor += 1
        continue
      }

      if (lines[cursor].trim() === "") {
        const nextLine = lines[cursor + 1] ?? ""
        const nextLineContinuesList = !codeLineIndexes.has(cursor + 1) &&
          (parseListItem(nextLine) || /^[ \t]{2,}\S/.test(nextLine))
        if (nextLineContinuesList) {
          cursor += 1
          continue
        }
        break
      }

      if (/^[ \t]{2,}\S/.test(lines[cursor])) {
        end = cursor
        cursor += 1
        continue
      }

      break
    }

    if (index > 0 && lines[index - 1].trim() !== "") {
      listSpacing.push(lineNumber)
    }
    if (end < lines.length - 1 && lines[end + 1].trim() !== "") {
      listSpacing.push(end + 2)
    }

    index = Math.max(index, cursor - 1)
  }

  return [...new Set(listSpacing)].sort((...values) => values[0] - values[1])
}

function collectListFormattingFindings({ lines, codeLineIndexes }) {
  return {
    ...collectListMarkerFindings({
      lines,
      codeLineIndexes,
    }),
    listSpacing: collectListSpacingFindings({
      lines,
      codeLineIndexes,
    }),
  }
}

function isTableDelimiterCandidate({ line, cells }) {
  return Boolean(
    cells &&
    line.includes("-") &&
    /^\s*\|?[\s:|-]+\|?\s*$/.test(line),
  )
}

function collectTableFormattingFindings({ lines, codeLineIndexes }) {
  const malformedTableDelimiters = []
  const tableColumnMismatches = []
  const tableSpacing = []

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (codeLineIndexes.has(index) || codeLineIndexes.has(index + 1)) {continue}

    const headerCells = splitTableCells(lines[index])
    const delimiterCells = splitTableCells(lines[index + 1])
    if (
      !headerCells ||
      !delimiterCells ||
      !isTableDelimiterCandidate({
        line: lines[index + 1],
        cells: delimiterCells,
      })
    ) {
      continue
    }

    const expectedColumnCount = headerCells.length
    const delimiterLine = index + 2

    if (delimiterCells.length !== expectedColumnCount) {
      tableColumnMismatches.push(delimiterLine)
    }
    if (delimiterCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
      malformedTableDelimiters.push(delimiterLine)
    }

    let end = index + 1
    let cursor = index + 2
    while (
      cursor < lines.length &&
      !codeLineIndexes.has(cursor) &&
      lines[cursor].trim() !== ""
    ) {
      const rowCells = splitTableCells(lines[cursor])
      if (!rowCells) {break}
      if (rowCells.length !== expectedColumnCount) {
        tableColumnMismatches.push(cursor + 1)
      }
      end = cursor
      cursor += 1
    }

    if (index > 0 && lines[index - 1].trim() !== "") {
      tableSpacing.push(index + 1)
    }
    if (end < lines.length - 1 && lines[end + 1].trim() !== "") {
      tableSpacing.push(end + 2)
    }

    index = end
  }

  return {
    malformedTableDelimiters,
    tableColumnMismatches,
    tableSpacing: [...new Set(tableSpacing)].sort((...values) => values[0] - values[1]),
  }
}

/**
 * Collect objective Markdown style metrics without enforcing or rewriting files.
 *
 * Fenced code content is excluded from prose/list/table analysis. A fence is
 * considered unlabeled when its opening delimiter has no info string. Findings
 * are grouped by file and include affected line numbers where applicable.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{fileCount: number, findings: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
function scanMarkdownDocumentLines({ content }) {
  const lines = content.split(/\r?\n/)
  const codeLineIndexes = collectIndentedCodeLineIndexes({ lines })
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
    const fencePattern = new RegExp(
      `^ {0,3}(${INLINE_CODE_DELIMITER}{3,}|~{3,})(.*)$`,
    )
    const fenceMatch = line.match(fencePattern)

    if (activeFence) {
      codeLineIndexes.add(index)
      const closesFence = fenceMatch &&
        fenceMatch[1][0] === activeFence.character &&
        fenceMatch[1].length >= activeFence.length &&
        /^[ \t]*$/.test(fenceMatch[2])
      if (closesFence) {activeFence = null}
      continue
    }

    if (fenceMatch) {
      codeLineIndexes.add(index)
      if (fenceMatch[2].trim() === "") {
        unlabelledCodeFenceLines.push(lineNumber)
      }
      activeFence = {
        character: fenceMatch[1][0],
        length: fenceMatch[1].length,
      }
      continue
    }

    if (codeLineIndexes.has(index)) {continue}

    if (/[ \t]+$/.test(line)) {trailingWhitespaceLines.push(lineNumber)}
    if (index > 0 && line.trim() === "" && lines[index - 1].trim() === "") {
      repeatedBlankLines.push(lineNumber)
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/)
    if (!headingMatch) {continue}

    const level = headingMatch[1].length
    if (level === 1) {h1Lines.push(lineNumber)}
    if (level > previousHeadingLevel + 1) {
      headingLevelSkips.push(lineNumber)
    }
    previousHeadingLevel = level
  }

  return {
    lines,
    codeLineIndexes,
    trailingWhitespaceLines,
    repeatedBlankLines,
    headingLevelSkips,
    unlabelledCodeFenceLines,
    h1Lines,
    hasFinalNewline: content.endsWith("\n"),
    hasCrlfLineEndings: content.includes("\r\n"),
  }
}

function createFindingRecorder({ findings, path }) {
  return ({ name, affectedLines = [] }) => {
    findings[name].push({
      path,
      count: Math.max(1, affectedLines.length),
      lines: affectedLines,
    })
  }
}

function collectDocumentFindings({ document, findings }) {
  if (
    !document ||
    typeof document.path !== "string" ||
    typeof document.content !== "string"
  ) {
    throw new TypeError("Each Markdown document must include a path and string content")
  }

  const { path, content } = document
  const addFinding = createFindingRecorder({
    findings,
    path,
  })
  const scannedDocument = scanMarkdownDocumentLines({ content })
  const lineFindings = [
    ["trailingWhitespace", scannedDocument.trailingWhitespaceLines],
    ["repeatedBlankLines", scannedDocument.repeatedBlankLines],
    ["headingLevelSkips", scannedDocument.headingLevelSkips],
    ["unlabelledCodeFences", scannedDocument.unlabelledCodeFenceLines],
  ]

  for (const [name, affectedLines] of lineFindings) {
    if (affectedLines.length > 0) {
      addFinding({
        name,
        affectedLines,
      })
    }
  }

  if (!scannedDocument.hasFinalNewline) {
    addFinding({ name: "missingFinalNewline" })
  }
  if (scannedDocument.hasCrlfLineEndings) {
    addFinding({ name: "crlfLineEndings" })
  }
  if (scannedDocument.h1Lines.length === 0) {
    addFinding({ name: "missingH1" })
  }
  if (scannedDocument.h1Lines.length > 1) {
    addFinding({
      name: "multipleH1",
      affectedLines: scannedDocument.h1Lines,
    })
  }

  const listFindings = collectListFormattingFindings({
    lines: scannedDocument.lines,
    codeLineIndexes: scannedDocument.codeLineIndexes,
  })
  for (const [name, affectedLines] of Object.entries(listFindings)) {
    if (affectedLines.length > 0) {
      addFinding({
        name,
        affectedLines,
      })
    }
  }

  const tableFindings = collectTableFormattingFindings({
    lines: scannedDocument.lines,
    codeLineIndexes: scannedDocument.codeLineIndexes,
  })
  for (const [name, affectedLines] of Object.entries(tableFindings)) {
    if (affectedLines.length > 0) {
      addFinding({
        name,
        affectedLines,
      })
    }
  }
}

/**
 * Collect objective Markdown style metrics without enforcing or rewriting files.
 *
 * Fenced code content is excluded from prose/list/table analysis. A fence is
 * considered unlabeled when its opening delimiter has no info string. Findings
 * are grouped by file and include affected line numbers where applicable.
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
    collectDocumentFindings({
      document,
      findings,
    })
  }

  return {
    fileCount: documents.length,
    findings,
  }
}

/**
 * Print the baseline for all repository Markdown/MDX documents.
 * Existing findings are informational and never fail this command.
 */
export function reportMarkdownStyleBaseline() {
  const documents = findMarkdownDocuments(repositoryRoot)
  const report = collectMarkdownStyleBaseline(documents)
  process.stdout.write(
    `Markdown style baseline (report-only): ${  report.fileCount  } files; no findings are enforced.\n`,
  )

  for (const [name, entries] of Object.entries(report.findings)) {
    const total = entries.reduce((...values) => values[0] + values[1].count, 0)
    process.stdout.write(`- ${  FINDING_LABELS[name]  }: ${  entries.length  } files / ${  total  } occurrences\n`)
    for (const entry of entries) {
      const lineDetail = entry.lines.length > 0
        ? ` (lines ${  entry.lines.join(", ")  })`
        : ""
      process.stdout.write(`  - ${  entry.path  }${lineDetail}\n`)
    }
  }

  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  reportMarkdownStyleBaseline()
}
