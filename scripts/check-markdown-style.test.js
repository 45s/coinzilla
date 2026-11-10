import assert from "node:assert/strict"
import test from "node:test"

import {
  analyzeMarkdownStyleDocuments,
  parseChangedMarkdownDiff,
  GIT_DIFF_MAX_BUFFER_BYTES,
} from "./check-markdown-style.js"

test("allows release-scale Git diffs larger than the child-process default buffer", () => {
  assert.equal(GIT_DIFF_MAX_BUFFER_BYTES, 64 * 1024 * 1024)
})

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

test("checks new files fully while preserving historical, superseded and GitHub template exceptions", () => {
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
        path: "apps/harvester/docs/DOMAIN_FIRST_DELIVERY_PLAN.md",
        content: "# Superseded plan  \n\n\nEvidence",
      },
      {
        path: ".github/PULL_REQUEST_TEMPLATE.md",
        content: "## Summary\n\nDescription  \n",
      },
      {
        path: ".github/ISSUE_TEMPLATE/cross-domain-request.md",
        content: "## Summary\n\nDescription.\n- item\n\n## Context\n\nDescription.\n",
      },
    ],
    new Map([
      ["docs/new.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      ["apps/harvester/AUDIT_2026-11-09.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      ["docs/ai-agent/repository-engineering-audit.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      ["apps/harvester/docs/DOMAIN_FIRST_DELIVERY_PLAN.md", { lines: new Set([1, 2, 3, 4]), isNewFile: true }],
      [".github/PULL_REQUEST_TEMPLATE.md", { lines: new Set([1, 2, 3]), isNewFile: true }],
      [".github/ISSUE_TEMPLATE/cross-domain-request.md", { lines: new Set([1, 2, 3, 4, 5]), isNewFile: true }],
    ]),
  )

  assert.equal(result.scannedFiles, 3, 'only maintained documents and GitHub templates should be scanned')
  assert.equal(result.skippedHistorical, 3, 'historical and superseded documents should be excluded from changed-line enforcement')
  assert.deepEqual(result.violations.trailingWhitespace.map(({ path }) => path), [
    "docs/new.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ], "maintained documents and templates should retain whitespace enforcement")
  assert.deepEqual(result.violations.missingFinalNewline.map(({ path }) => path), [
    "docs/new.md",
  ], "new maintained documents should require a final newline")
  assert.deepEqual(result.violations.repeatedBlankLines.map(({ path }) => path), [
    "docs/new.md",
  ], "new maintained documents should not contain repeated blank lines")
  assert.deepEqual(result.violations.headingLevelSkips.map(({ path }) => path), [
    "docs/new.md",
  ], "new maintained documents should use sequential heading levels")
  assert.deepEqual(result.violations.missingH1.map(({ path }) => path), [], "new maintained documents should contain one H1")
  assert.deepEqual(result.violations.listSpacing.map(({ path }) => path), [
    ".github/ISSUE_TEMPLATE/cross-domain-request.md",
  ], "template heading exemptions must not disable list-spacing enforcement")
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


test("enforces every existing style rule for new maintained documents", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const documents = [
    { path: "docs/trailing.md", content: "# Title\nText  \n" },
    { path: "docs/final-newline.md", content: "# Title" },
    { path: "docs/crlf.md", content: "# Title\r\n" },
    { path: "docs/repeated-blank.md", content: "# Title\n\n\nText\n" },
    { path: "docs/missing-h1.md", content: "## Section\n" },
    { path: "docs/multiple-h1.md", content: "# First\n# Second\n" },
    { path: "docs/heading-skip.md", content: "# First\n### Third\n" },
    { path: "docs/unlabelled-fence.md", content: "# Code\n\n" + fence + "\ncode\n" + fence + "\n" },
    { path: "docs/code-only.md", content: "# Code\n\n" + fence + "md\nText  \n\n\n### Not a heading\n# Not another H1\n" + fence + "\n" },
  ]
  const changes = new Map(documents.map(({ path, content }) => [
    path,
    { lines: new Set(content.split(/\r?\n/).map((line, index) => index + 1)), isNewFile: true },
  ]))
  const result = analyzeMarkdownStyleDocuments(documents, changes)

  const expected = {
    trailingWhitespace: "docs/trailing.md",
    missingFinalNewline: "docs/final-newline.md",
    crlfLineEndings: "docs/crlf.md",
    repeatedBlankLines: "docs/repeated-blank.md",
    missingH1: "docs/missing-h1.md",
    multipleH1: "docs/multiple-h1.md",
    headingLevelSkips: "docs/heading-skip.md",
    unlabelledCodeFences: "docs/unlabelled-fence.md",
  }
  for (const [rule, path] of Object.entries(expected)) {
    assert.ok(result.violations[rule].some((entry) => entry.path === path), rule + " must be enforced")
  }
  for (const rule of Object.keys(expected)) {
    assert.equal(result.violations[rule].some((entry) => entry.path === "docs/code-only.md"), false, rule + " must ignore fenced content")
  }
})

test("keeps non-spacing list and table structure metrics report-only after list-spacing migration", () => {
  const content = [
    "# Title",
    "Paragraph",
    "* item",
    "   - nested",
    "After list",
    "| A | B |",
    "| -- | --- |",
    "| one | two | extra |",
    "After table",
    "",
  ].join("\n")
  const result = analyzeMarkdownStyleDocuments(
    [{ path: "docs/new-list-table.md", content }],
    new Map([["docs/new-list-table.md", {
      lines: new Set(content.split("\n").map((line, index) => index + 1)),
      isNewFile: true,
    }]]),
  )

  for (const rule of [
    "unorderedListMarkers",
    "nestedListIndentation",
    "malformedTableDelimiters",
    "tableColumnMismatches",
    "tableSpacing",
  ]) {
    assert.deepEqual(result.violations[rule], [], rule + " remains report-only")
  }
})

test("enforces blank lines before and after list blocks in changed maintained documents", () => {
  const content = "# Title\n\nIntro paragraph.\n- item\nAfter list.\n"
  const result = analyzeMarkdownStyleDocuments(
    [{ path: "docs/list-spacing.md", content }],
    new Map([["docs/list-spacing.md", {
      lines: new Set(content.split("\n").map((line, index) => index + 1)),
      isNewFile: true,
    }]]),
  )

  assert.deepEqual(result.violations.listSpacing, [
    { path: "docs/list-spacing.md", count: 2, lines: [4, 5] },
  ])
})

test("accepts list blocks separated from surrounding content by blank lines", () => {
  const content = "# Title\n\nIntro paragraph.\n\n- item\n\nAfter list.\n"
  const result = analyzeMarkdownStyleDocuments(
    [{ path: "docs/list-spacing.md", content }],
    new Map([["docs/list-spacing.md", {
      lines: new Set(content.split("\n").map((line, index) => index + 1)),
      isNewFile: true,
    }]]),
  )

  assert.deepEqual(result.violations.listSpacing, [])
})

test("does not require unrelated pre-existing list spacing to be cleaned in an edited document", () => {
  const content = "# Existing\n\nIntro paragraph.\n- old item\n\nChanged paragraph.\n"
  const result = analyzeMarkdownStyleDocuments(
    [{ path: "docs/existing.md", content }],
    new Map([["docs/existing.md", { lines: new Set([6]), isNewFile: false }]]),
  )

  assert.deepEqual(result.violations.listSpacing, [])
})

test("excludes historical documents from every changed-file style rule", () => {
  const fence = String.fromCharCode(96).repeat(3)
  const content = "# Historical  \r\n\n\n### Skipped\r\n# Second H1\r\n" + fence + "\ncode\n" + fence + "\nParagraph\n- item\n"
  const result = analyzeMarkdownStyleDocuments(
    [{ path: "apps/harvester/docs/audits/legacy-style.md", content }],
    new Map([["apps/harvester/docs/audits/legacy-style.md", {
      lines: new Set(content.split(/\r?\n/).map((line, index) => index + 1)),
      isNewFile: true,
    }]]),
  )

  assert.equal(result.scannedFiles, 0)
  assert.equal(result.skippedHistorical, 1)
  assert.deepEqual(Object.values(result.violations).flat(), [])
})
