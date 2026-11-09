import assert from "node:assert/strict"
import test from "node:test"

import {
  analyzeMarkdownStyleDocuments,
  parseChangedMarkdownDiff,
} from "./check-markdown-style.js"

test("parses changed Markdown lines and new files from a unified diff", () => {
  const diff = [
    "diff --git a/docs/existing.md b/docs/existing.md",
    "index abc..def 100644",
    "--- a/docs/existing.md",
    "+++ b/docs/existing.md",
    "@@ -3,3 +3,3 @@",
    " context before",
    "+# Changed heading",
    "-## Old heading",
    " context after",
    "@@ -6,2 +6,3 @@",
    "+++added content",
    "---removed content",
    " context after",
    "diff --git a/docs/new.md b/docs/new.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/docs/new.md",
    "@@ -0,0 +1,2 @@",
    "+# New",
    "+Text",
  ].join("\n")

  const changes = parseChangedMarkdownDiff(diff)
  assert.deepEqual([...changes.get("docs/existing.md").lines], [3, 4, 5, 6, 7])
  assert.equal(changes.get("docs/existing.md").isNewFile, false)
  assert.equal(changes.get("docs/existing.md").removedHeading, true)
  assert.deepEqual([...changes.get("docs/new.md").lines], [1, 2])
  assert.equal(changes.get("docs/new.md").isNewFile, true)
})

test("does not force cleanup of unrelated pre-existing findings in an edited document", () => {
  const result = analyzeMarkdownStyleDocuments(
    [{
      path: "docs/existing.md",
      content: "# Existing\n\nold text  \n\n\n## Details\n\nChanged paragraph.\n",
    }],
    new Map([["docs/existing.md", { lines: new Set([8]), isNewFile: false }]]),
  )

  assert.equal(result.scannedFiles, 1)
  assert.deepEqual(Object.values(result.violations).flat(), [])
})

test("enforces whitespace and heading rules when the affected lines change", () => {
  const result = analyzeMarkdownStyleDocuments(
    [{
      path: "docs/changed.md",
      content: "# Title\n\nText  \n\n\n### Skipped\n",
    }],
    new Map([["docs/changed.md", { lines: new Set([3, 4, 5, 6]), isNewFile: false }]]),
  )

  assert.deepEqual(result.violations.trailingWhitespace.map(({ path }) => path), [
    "docs/changed.md",
  ])
  assert.deepEqual(result.violations.repeatedBlankLines.map(({ path }) => path), [
    "docs/changed.md",
  ])
  assert.deepEqual(result.violations.headingLevelSkips.map(({ path }) => path), [
    "docs/changed.md",
  ])
})

test("checks new files fully while preserving historical and GitHub template exceptions", () => {
  const result = analyzeMarkdownStyleDocuments(
    [
      {
        path: "docs/new.md",
        content: "# New  \n\n\n### Skipped",
      },
      {
        path: "apps/harvester/AUDIT_2026-11-09.md",
        content: "# Historical  \n\n\nEvidence",
      },
      {
        path: "docs/ai-agent/repository-engineering-audit.md",
        content: "# Historical task brief  \n\n\nEvidence",
      },
      {
        path: ".github/PULL_REQUEST_TEMPLATE.md",
        content: "## Summary\n\nDescription  \n",
      },
      {
        path: ".github/ISSUE_TEMPLATE/cross-domain-request.md",
        content: "## Summary\n\n## Context\n\nDescription.\n",
      },
    ],
    new Map([
      ["docs/new.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      ["apps/harvester/AUDIT_2026-11-09.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      ["docs/ai-agent/repository-engineering-audit.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      [".github/PULL_REQUEST_TEMPLATE.md", { lines: new Set([1, 2, 3]), isNewFile: true }],
      [".github/ISSUE_TEMPLATE/cross-domain-request.md", { lines: new Set([1, 2, 3, 4, 5]), isNewFile: true }],
    ]),
  )

  assert.equal(result.scannedFiles, 3)
  assert.equal(result.skippedHistorical, 2)
  assert.deepEqual(result.violations.trailingWhitespace.map(({ path }) => path), [
    "docs/new.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ])
  assert.deepEqual(result.violations.missingFinalNewline.map(({ path }) => path), [
    "docs/new.md",
  ])
  assert.deepEqual(result.violations.repeatedBlankLines.map(({ path }) => path), [
    "docs/new.md",
  ])
  assert.deepEqual(result.violations.headingLevelSkips.map(({ path }) => path), [
    "docs/new.md",
  ])
  assert.deepEqual(result.violations.missingH1.map(({ path }) => path), [])
})

test("accepts a clean changed document", () => {
  const result = analyzeMarkdownStyleDocuments(
    [{
      path: "docs/clean.md",
      content: "# Clean\n\n## Details\n\nNo style findings.\n",
    }],
    new Map([["docs/clean.md", { lines: new Set([1, 3]), isNewFile: false }]]),
  )

  assert.equal(result.scannedFiles, 1)
  assert.deepEqual(Object.values(result.violations).flat(), [])
})
