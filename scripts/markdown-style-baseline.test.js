import assert from "node:assert/strict"
import test from "node:test"

import { collectMarkdownStyleBaseline } from "./markdown-style-baseline.js"

test("reports objective Markdown style metrics without enforcing or rewriting documents", () => {
  const report = collectMarkdownStyleBaseline([
    {
      path: "docs/bad.md",
      content: "# First  \n\n\n### Skipped\n# Second\n",
    },
    {
      path: "docs/no-heading.md",
      content: "Plain text\r\n## Section\r\n~~~\ncode\n~~~",
    },
    {
      path: "docs/code-sample.md",
      content: "# Example\n\n```js\nconst value = 1  \n\n\n```\n",
    },
  ])

  assert.equal(report.fileCount, 3)
  assert.deepEqual(report.findings.trailingWhitespace.map(({ path }) => path), [
    "docs/bad.md",
  ])
  assert.deepEqual(report.findings.missingFinalNewline.map(({ path }) => path), [
    "docs/no-heading.md",
  ])
  assert.equal(report.findings.missingFinalNewline[0].count, 1)
  assert.deepEqual(report.findings.crlfLineEndings.map(({ path }) => path), [
    "docs/no-heading.md",
  ])
  assert.deepEqual(report.findings.repeatedBlankLines.map(({ path }) => path), [
    "docs/bad.md",
  ])
  assert.deepEqual(report.findings.missingH1.map(({ path }) => path), [
    "docs/no-heading.md",
  ])
  assert.equal(report.findings.missingH1[0].count, 1)
  assert.deepEqual(report.findings.multipleH1.map(({ path }) => path), [
    "docs/bad.md",
  ])
  assert.deepEqual(report.findings.headingLevelSkips.map(({ path }) => path), [
    "docs/bad.md",
    "docs/no-heading.md",
  ])
  assert.deepEqual(report.findings.unlabelledCodeFences.map(({ path }) => path), [
    "docs/no-heading.md",
  ])
})


test("reports list and table structural findings with source line numbers", () => {
  const content = [
    "# Formatting",
    "Paragraph without a separator",
    "* first item",
    "   - nested item with three-space indentation",
    "+ second item",
    "After list without a separator",
    "| Name | Value |",
    "| --- | -- |",
    "| one | two | extra |",
    "After table without a separator",
    "",
  ].join("\n")
  const report = collectMarkdownStyleBaseline([
    { path: "docs/list-table-findings.md", content },
  ])

  assert.deepEqual(report.findings.unorderedListMarkers[0], {
    path: "docs/list-table-findings.md", count: 2, lines: [3, 5],
  })
  assert.deepEqual(report.findings.nestedListIndentation[0], {
    path: "docs/list-table-findings.md", count: 1, lines: [4],
  })
  assert.deepEqual(report.findings.listSpacing[0], {
    path: "docs/list-table-findings.md", count: 2, lines: [3, 6],
  })
  assert.deepEqual(report.findings.malformedTableDelimiters[0], {
    path: "docs/list-table-findings.md", count: 1, lines: [8],
  })
  assert.deepEqual(report.findings.tableColumnMismatches[0], {
    path: "docs/list-table-findings.md", count: 1, lines: [9],
  })
  assert.deepEqual(report.findings.tableSpacing[0], {
    path: "docs/list-table-findings.md", count: 2, lines: [7, 10],
  })
})

test("accepts canonical list and table formatting", () => {
  const content = [
    "# Formatting",
    "",
    "Paragraph.",
    "",
    "- first item",
    "  - nested item",
    "- second item",
    "1. ordered parent",
    "   - nested under ordered parent",
    "2. next ordered parent",
    "",
    "After list.",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| one | two |",
    "",
    "After table.",
    "",
  ].join("\n")
  const report = collectMarkdownStyleBaseline([
    { path: "docs/list-table-clean.md", content },
  ])

  for (const name of [
    "unorderedListMarkers",
    "nestedListIndentation",
    "listSpacing",
    "malformedTableDelimiters",
    "tableColumnMismatches",
    "tableSpacing",
  ]) {
    assert.deepEqual(report.findings[name], [], name + " should accept canonical formatting")
  }
})

test("excludes fenced examples but retains historical documents in the report-only baseline", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const codeContent = [
    "# Code examples",
    "",
    fence + "md",
    "* unordered marker",
    "   - odd nested indentation",
    "Paragraph without a separator",
    "| Name | Value |",
    "| --- | -- |",
    "| one | two | extra |",
    fence,
    "",
  ].join("\n")
  const historicalListTable = [
    "# Historical evidence",
    "Paragraph without a separator",
    "* historical marker",
    "   - historical nested item",
    "After list",
    "| Name | Value |",
    "| --- | -- |",
    "| one | two | extra |",
    "After table",
    "",
  ].join("\n")
  const historicalStyle = "Plain text  \n\n\n### Historical section\n# First H1\n# Second H1\n"
  const historicalNoHeading = "Plain text\r\n## Section\r\n~~~\ncode\n~~~"

  const report = collectMarkdownStyleBaseline([
    { path: "docs/clean.md", content: "# Clean\n\n## Details\n\nNo findings.\n" },
    { path: "docs/code-examples.md", content: codeContent },
    { path: "apps/harvester/docs/audits/legacy-list-table.md", content: historicalListTable },
    { path: "apps/harvester/docs/audits/legacy-style.md", content: historicalStyle },
    { path: "docs/audits/legacy-no-heading.md", content: historicalNoHeading },
  ])

  for (const name of Object.keys(report.findings)) {
    assert.equal(report.findings[name].some(({ path }) => path === "docs/clean.md"), false)
    assert.equal(report.findings[name].some(({ path }) => path === "docs/code-examples.md"), false)
  }

  for (const name of [
    "unorderedListMarkers", "nestedListIndentation", "listSpacing",
    "malformedTableDelimiters", "tableColumnMismatches", "tableSpacing",
  ]) {
    assert.ok(report.findings[name].some(({ path }) => path === "apps/harvester/docs/audits/legacy-list-table.md"))
  }

  for (const name of ["trailingWhitespace", "repeatedBlankLines", "multipleH1", "headingLevelSkips"]) {
    assert.ok(report.findings[name].some(({ path }) => path === "apps/harvester/docs/audits/legacy-style.md"))
  }

  for (const name of ["missingFinalNewline", "crlfLineEndings", "missingH1", "headingLevelSkips", "unlabelledCodeFences"]) {
    assert.ok(report.findings[name].some(({ path }) => path === "docs/audits/legacy-no-heading.md"))
  }
})
