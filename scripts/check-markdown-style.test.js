import assert from "node:assert/strict"
import test from "node:test"

import { analyzeMarkdownStyleDocuments } from "./check-markdown-style.js"

test("enforces style on changed maintained documents but preserves historical and template exceptions", () => {
  const result = analyzeMarkdownStyleDocuments([
    {
      path: "docs/good.md",
      content: "# Good\n\n## Details\n\nCurrent guidance.\n",
    },
    {
      path: "docs/bad.md",
      content: "# Bad  \n\n\n### Skipped",
    },
    {
      path: ".github/PULL_REQUEST_TEMPLATE.md",
      content: "## Summary\n\nDescription  \n",
    },
    {
      path: "apps/harvester/AUDIT_2026-11-09.md",
      content: "# Historical  \n\n\nEvidence",
    },
  ])

  assert.equal(result.scannedFiles, 3)
  assert.equal(result.skippedHistorical, 1)
  assert.deepEqual(result.violations.trailingWhitespace.map(({ path }) => path), [
    "docs/bad.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ])
  assert.deepEqual(result.violations.missingFinalNewline.map(({ path }) => path), [
    "docs/bad.md",
  ])
  assert.deepEqual(result.violations.repeatedBlankLines.map(({ path }) => path), [
    "docs/bad.md",
  ])
  assert.deepEqual(result.violations.missingH1.map(({ path }) => path), [])
  assert.deepEqual(result.violations.headingLevelSkips.map(({ path }) => path), [
    "docs/bad.md",
  ])
})

test("accepts a clean maintained Markdown document", () => {
  const result = analyzeMarkdownStyleDocuments([
    {
      path: "docs/clean.md",
      content: "# Clean\n\n## Details\n\nNo style findings.\n",
    },
  ])

  assert.equal(result.scannedFiles, 1)
  assert.deepEqual(
    Object.values(result.violations).flat(),
    [],
  )
})
