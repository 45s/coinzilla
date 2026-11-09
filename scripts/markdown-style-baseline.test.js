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
      content: "# Example\\n\\n```js\\nconst value = 1  \\n\\n\\n```\\n",
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
