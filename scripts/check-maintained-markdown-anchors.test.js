import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { findMissingLocalAnchors } from "./check-agent-policy.js"
import { findMissingMaintainedLocalAnchors } from "./check-maintained-markdown-anchors.js"

test("blocks unresolved anchors from maintained sources and reports historical sources only", () => {
  const root = mkdtempSync(join(tmpdir(), "maintained-markdown-anchors-"))
  const documents = [
    {
      path: "docs/audits/README.md",
      content: [
        "# Audit index",
        "",
        "[Missing historical heading](repository-engineering-audit.md#missing-section)",
        "",
      ].join("\n"),
    },
    {
      path: "docs/audits/repository-engineering-audit.md",
      content: "# Historical audit\n",
    },
    {
      path: "docs/guide.md",
      content: [
        "# Guide",
        "",
        "[Missing heading in historical target](audits/repository-engineering-audit.md#missing-section)",
        "",
      ].join("\n"),
    },
    {
      path: ".github/PULL_REQUEST_TEMPLATE.md",
      content: [
        "# Pull request",
        "",
        "[Missing heading](../docs/guide.md#missing-section)",
        "",
      ].join("\n"),
    },
    {
      path: "apps/harvester/docs/audits/reports/AUDIT.md",
      content: [
        "# Historical report",
        "",
        "[Missing historical anchor](#missing-section)",
        "",
      ].join("\n"),
    },
  ]

  try {
    for (const document of documents) {
      const absolutePath = join(root, document.path)
      mkdirSync(join(absolutePath, ".."), { recursive: true })
      writeFileSync(absolutePath, document.content)
    }

    const allGaps = findMissingLocalAnchors(root, documents)
    const maintainedGaps = findMissingMaintainedLocalAnchors(root, documents)

    assert.equal(allGaps.length, 4)
    assert.equal(maintainedGaps.length, 3)
    assert.ok(maintainedGaps.some((finding) => finding.startsWith("docs/audits/README.md ")))
    assert.ok(maintainedGaps.some((finding) => finding.startsWith("docs/guide.md ")))
    assert.ok(maintainedGaps.some((finding) => finding.startsWith(".github/PULL_REQUEST_TEMPLATE.md ")))
    assert.equal(
      maintainedGaps.some((finding) => finding.startsWith("apps/harvester/docs/audits/reports/AUDIT.md ")),
      false,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
