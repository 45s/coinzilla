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

function hasIndentedCodeAfterBlankLines({
          lines,
          index,
        }) {
  let nextContentIndex = index + 1
  while (
    nextContentIndex < lines.length &&
    lines[nextContentIndex].trim() === ""
  ) {
    nextContentIndex += 1
  }

  return nextContentIndex < lines.length &&
    isIndentedCodeLine(lines[nextContentIndex])
}

function collectIndentedCodeLineIndexes({ lines }) {
  const codeLineIndexes = new Set()
  let isInsideIndentedCodeBlock = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === "") {
      if (
        isInsideIndentedCodeBlock &&
        hasIndentedCodeAfterBlankLines({
          lines,
          index,
        })
      ) {
        codeLineIndexes.add(index)
      } else if (isInsideIndentedCodeBlock) {
        isInsideIndentedCodeBlock = false
      }
      continue
    }

    if (isInsideIndentedCodeBlock && isIndentedCodeLine(line)) {
      codeLineIndexes.add(index)
      continue
    }
    if (isInsideIndentedCodeBlock) {
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

function normalizeTableSource(line) {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) {return null}

  let source = trimmed
  if (source.startsWith("|")) {source = source.slice(1)}
  if (source.endsWith("|") && !source.endsWith("\\|")) {
    source = source.slice(0, -1)
  }
  return source
}

function getCodeSpanDelimiterLength({
      source,
      index,
    }) {
  if (source[index] !== INLINE_CODE_DELIMITER) {return 0}

  let delimiterLength = 1
  while (source[index + delimiterLength] === INLINE_CODE_DELIMITER) {
    delimiterLength += 1
  }
  return delimiterLength
}

function updateCodeSpanDelimiterLength({ activeLength, delimiterLength }) {
  if (activeLength === 0) {return delimiterLength}
  return activeLength === delimiterLength ? 0 : activeLength
}

function collectTableCells({ source }) {
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

    const delimiterLength = getCodeSpanDelimiterLength({
      source,
      index,
    })
    if (delimiterLength > 0) {
      activeCodeDelimiterLength = updateCodeSpanDelimiterLength({
        activeLength: activeCodeDelimiterLength,
        delimiterLength,
      })
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
  return cells
}

function splitTableCells(line) {
  const source = normalizeTableSource(line)
  if (source === null) {return null}

  const cells = collectTableCells({ source })
  return cells.length >= 2 ? cells : null
}

function resetListParentStack({ line, parentStack }) {
  if (line.trim() === "") {return}

  const indentation = getIndentationWidth(line)
  const parent = parentStack[parentStack.length - 1]
  if (parent && indentation >= parent.contentColumn) {return}

  parentStack.length = 0
}

function recordListItem({
  item,
  lineNumber,
  parentStack,
  unorderedListMarkers,
  nestedListIndentation,
}) {
  if (item.marker === "*" || item.marker === "+") {
    unorderedListMarkers.push(lineNumber)
  }

  const indentWidth = getIndentationWidth(item.indent)
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

function collectListMarkerFindings({ lines, codeLineIndexes }) {
  const unorderedListMarkers = []
  const nestedListIndentation = []
  const parentStack = []

  for (let index = 0; index < lines.length; index += 1) {
    if (codeLineIndexes.has(index)) {continue}

    const item = parseListItem(lines[index])
    if (!item) {
      resetListParentStack({
        line: lines[index],
        parentStack,
      })
      continue
    }

    recordListItem({
      item,
      lineNumber: index + 1,
      parentStack,
      unorderedListMarkers,
      nestedListIndentation,
    })
  }

  return {
    unorderedListMarkers,
    nestedListIndentation,
  }
}

function isListContinuationAfterBlank({
        lines,
        cursor,
        codeLineIndexes,
      }) {
  const nextIndex = cursor + 1
  const nextLine = lines[nextIndex] ?? ""
  return !codeLineIndexes.has(nextIndex) &&
    Boolean(parseListItem(nextLine) || /^[ \t]{2,}\S/.test(nextLine))
}

function findListBlockEnd({ lines, startIndex, codeLineIndexes }) {
  let end = startIndex
  let cursor = startIndex + 1

  while (cursor < lines.length) {
    if (codeLineIndexes.has(cursor)) {break}

    if (parseListItem(lines[cursor])) {
      end = cursor
      cursor += 1
      continue
    }

    if (lines[cursor].trim() === "") {
      if (isListContinuationAfterBlank({
          lines,
          cursor,
          codeLineIndexes,
        })) {
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

  return {
    end,
    cursor,
  }
}

function collectListSpacingFindings({ lines, codeLineIndexes }) {
  const listSpacing = []

  for (let index = 0; index < lines.length; index += 1) {
    if (codeLineIndexes.has(index)) {continue}

    const item = parseListItem(lines[index])
    if (!item || item.indent !== "") {continue}

    const { end, cursor } = findListBlockEnd({
      lines,
      startIndex: index,
      codeLineIndexes,
    })

    if (index > 0 && lines[index - 1].trim() !== "") {
      listSpacing.push(index + 1)
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

function collectTableRowFindings({
  lines,
  startIndex,
  expectedColumnCount,
  codeLineIndexes,
}) {
  const tableColumnMismatches = []
  let end = startIndex + 1
  let cursor = startIndex + 2

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

  return {
    end,
    tableColumnMismatches,
  }
}

function collectTableBlockFindings({ lines, index, codeLineIndexes }) {
  const headerCells = splitTableCells(lines[index])
  if (!headerCells) {return null}

  const delimiterCells = splitTableCells(lines[index + 1])
  if (
    !delimiterCells ||
    !isTableDelimiterCandidate({
      line: lines[index + 1],
      cells: delimiterCells,
    })
  ) {
    return null
  }

  const expectedColumnCount = headerCells.length
  const rowFindings = collectTableRowFindings({
    lines,
    startIndex: index,
    expectedColumnCount,
    codeLineIndexes,
  })
  const tableColumnMismatches = [...rowFindings.tableColumnMismatches]
  if (delimiterCells.length !== expectedColumnCount) {
    tableColumnMismatches.unshift(index + 2)
  }

  const malformedTableDelimiters = delimiterCells.some(
    (cell) => !/^:?-{3,}:?$/.test(cell),
  ) ? [index + 2] : []
  const tableSpacing = []
  if (index > 0 && lines[index - 1].trim() !== "") {
    tableSpacing.push(index + 1)
  }
  if (
    rowFindings.end < lines.length - 1 &&
    lines[rowFindings.end + 1].trim() !== ""
  ) {
    tableSpacing.push(rowFindings.end + 2)
  }

  return {
    end: rowFindings.end,
    malformedTableDelimiters,
    tableColumnMismatches,
    tableSpacing,
  }
}

function collectTableFormattingFindings({ lines, codeLineIndexes }) {
  const malformedTableDelimiters = []
  const tableColumnMismatches = []
  const tableSpacing = []

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (codeLineIndexes.has(index) || codeLineIndexes.has(index + 1)) {continue}

    const tableFindings = collectTableBlockFindings({
      lines,
      index,
      codeLineIndexes,
    })
    if (!tableFindings) {continue}

    malformedTableDelimiters.push(...tableFindings.malformedTableDelimiters)
    tableColumnMismatches.push(...tableFindings.tableColumnMismatches)
    tableSpacing.push(...tableFindings.tableSpacing)
    index = tableFindings.end
  }

  return {
    malformedTableDelimiters,
    tableColumnMismatches,
    tableSpacing: [...new Set(tableSpacing)].sort((...values) => values[0] - values[1]),
  }
}

function getFenceTransition({ fenceMatch, activeFence }) {
  if (activeFence) {
    const closesFence = Boolean(
      fenceMatch &&
      fenceMatch[1][0] === activeFence.character &&
      fenceMatch[1].length >= activeFence.length &&
      /^[ \t]*$/.test(fenceMatch[2]),
    )
    return {
      isCode: true,
      isUnlabelled: false,
      activeFence: closesFence ? null : activeFence,
    }
  }

  if (!fenceMatch) {
    return {
      isCode: false,
      isUnlabelled: false,
      activeFence: null,
    }
  }

  return {
    isCode: true,
    isUnlabelled: fenceMatch[2].trim() === "",
    activeFence: {
      character: fenceMatch[1][0],
      length: fenceMatch[1].length,
    },
  }
}

function collectLineFormattingFindings({
  line,
  index,
  lines,
  lineNumber,
  previousHeadingLevel,
  trailingWhitespaceLines,
  repeatedBlankLines,
  headingLevelSkips,
  h1Lines,
}) {
  if (/[ \t]+$/.test(line)) {trailingWhitespaceLines.push(lineNumber)}
  if (
    index > 0 &&
    line.trim() === "" &&
    lines[index - 1].trim() === ""
  ) {
    repeatedBlankLines.push(lineNumber)
  }

  const headingMatch = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/)
  if (!headingMatch) {return previousHeadingLevel}

  const level = headingMatch[1].length
  if (level === 1) {h1Lines.push(lineNumber)}
  if (level > previousHeadingLevel + 1) {
    headingLevelSkips.push(lineNumber)
  }
  return level
}

/**
 * Collect objective Markdown style metrics without enforcing or rewriting files.
 *
 * Fenced and indented code content is excluded from prose/list/table analysis. A fence is
 * considered unlabeled when its opening delimiter has no info string. Findings
 * are grouped by file and include affected line numbers where applicable.
 *
 * @param {{content: string}} input
 * @returns {{fileCount: number, findings: Record<string, Array<{path: string, count: number, lines: number[]}>>}}
 */
function scanMarkdownDocumentLines({
    content,
  }) {
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
    const fenceMatch = line.match(
      new RegExp(`^ {0,3}(${INLINE_CODE_DELIMITER}{3,}|~{3,})(.*)$`),
    )
    const fenceTransition = getFenceTransition({
      fenceMatch,
      activeFence,
    })
    const { activeFence: nextActiveFence } = fenceTransition
    activeFence = nextActiveFence

    if (fenceTransition.isCode) {
      codeLineIndexes.add(index)
      if (fenceTransition.isUnlabelled) {
        unlabelledCodeFenceLines.push(lineNumber)
      }
      continue
    }

    if (codeLineIndexes.has(index)) {continue}

    previousHeadingLevel = collectLineFormattingFindings({
      line,
      index,
      lines,
      lineNumber,
      previousHeadingLevel,
      trailingWhitespaceLines,
      repeatedBlankLines,
      headingLevelSkips,
      h1Lines,
    })
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

function createFindingRecorder({
    findings,
    path,
  }) {
  return ({ name, affectedLines = [] }) => {
    findings[name].push({
      path,
      count: Math.max(1, affectedLines.length),
      lines: affectedLines,
    })
  }
}

function addLineFindings({
    scannedDocument,
    addFinding,
  }) {
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
}

function addDocumentMetadataFindings({
    scannedDocument,
    addFinding,
  }) {
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
}

function addStructureFindings({
    scannedDocument,
    addFinding,
  }) {
  const listFindings = collectListFormattingFindings({
    lines: scannedDocument.lines,
    codeLineIndexes: scannedDocument.codeLineIndexes,
  })
  const tableFindings = collectTableFormattingFindings({
    lines: scannedDocument.lines,
    codeLineIndexes: scannedDocument.codeLineIndexes,
  })

  for (const findings of [listFindings, tableFindings]) {
    for (const [name, affectedLines] of Object.entries(findings)) {
      if (affectedLines.length > 0) {
        addFinding({
          name,
          affectedLines,
        })
      }
    }
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
  const scannedDocument = scanMarkdownDocumentLines({
    content,
  })

  addLineFindings({
    scannedDocument,
    addFinding,
  })
  addDocumentMetadataFindings({
    scannedDocument,
    addFinding,
  })
  addStructureFindings({
    scannedDocument,
    addFinding,
  })
}

/**
 * Collect objective Markdown style metrics without enforcing or rewriting files.
 *
 * Fenced and indented code content is excluded from prose/list/table analysis. A fence is
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
