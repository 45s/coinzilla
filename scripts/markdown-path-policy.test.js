import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyMarkdownPath,
  isHistoricalPath,
  isTemplateHeadingExempt,
} from "./markdown-path-policy.js"

test("classifies explicit historical evidence and audit snapshots", () => {
  const paths = [
    "apps/harvester/AUDIT_2026-11-10.md",
    "apps/harvester/docs/audits/README_HISTORY.md",
    "apps/harvester/docs/audits/ROADMAP_HISTORY.md",
    "apps/harvester/docs/audits/reports/AUDIT.md",
    "apps/harvester/docs/audits/sessions/session-001.md",
    "apps/harvester/docs/audits/evidence/evidence-001.md",
    "apps/harvester/docs/incidents/incident-001.md",
    "apps/harvester/docs/tasks/task-001.md",
    "apps/harvester/docs/DDD_CLEAN_ARCHITECTURE_AUDIT.md",
    "apps/harvester/docs/DOMAIN_FIRST_DELIVERY_PLAN.md",
    "docs/audits/repository-engineering-audit.md",
    "docs/ai-agent/repository-engineering-audit.md",
  ]

  for (const path of paths) {
    assert.equal(
      classifyMarkdownPath(path),
      "historical",
      `${path} must be classified as preserved historical evidence`,
    )
    assert.equal(
      isHistoricalPath(path),
      true,
      `${path} must be excluded from blocking maintained-document enforcement`,
    )
  }
})

test("keeps maintained archive indexes and investigation templates in scope", () => {
  const paths = [
    "docs/audits/README.md",
    "apps/harvester/docs/audits/README.md",
    "apps/harvester/docs/audits/reports/README.md",
    "apps/harvester/docs/audits/sessions/README.md",
    "apps/harvester/docs/audits/evidence/README.md",
    "apps/harvester/docs/incidents/README.md",
    "apps/harvester/docs/tasks/README.md",
    "apps/harvester/docs/audits/INVESTIGATION_TEMPLATE.md",
    ".github/copilot-instructions.md",
  ]

  for (const path of paths) {
    assert.equal(
      classifyMarkdownPath(path),
      "maintained",
      `${path} must remain in the maintained-document enforcement scope`,
    )
    assert.equal(
      isHistoricalPath(path),
      false,
      `${path} must not be excluded as historical evidence`,
    )
    assert.equal(
      isTemplateHeadingExempt(path),
      false,
      `${path} must not inherit GitHub template heading exemptions`,
    )
  }
})

test("limits heading exemptions to GitHub issue and pull-request templates", () => {
  const paths = [
    ".github/ISSUE_TEMPLATE/cross-domain-request.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ]

  for (const path of paths) {
    assert.equal(
      classifyMarkdownPath(path),
      "github-template",
      `${path} must use the GitHub template classification`,
    )
    assert.equal(
      isHistoricalPath(path),
      false,
      `${path} must remain subject to non-heading style and anchor checks`,
    )
    assert.equal(
      isTemplateHeadingExempt(path),
      true,
      `${path} must receive only the documented heading exemptions`,
    )
  }
})

test("classifies invalid or missing paths as unknown", () => {
  assert.equal(
    classifyMarkdownPath(""),
    "unknown",
    "empty paths must not be mistaken for maintained or historical documents",
  )
  assert.equal(
    classifyMarkdownPath(null),
    "unknown",
    "non-string paths must be rejected by the path classifier",
  )
  assert.equal(
    isHistoricalPath(null),
    false,
    "invalid paths must not be silently classified as historical evidence",
  )
  assert.equal(
    isTemplateHeadingExempt(null),
    false,
    "invalid paths must not receive GitHub template exemptions",
  )
})
