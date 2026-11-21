import assert from "node:assert/strict"
import test from "node:test"

import { parseWorkspaceDependencyPolicy } from "./workspace-package-policy.js"

const policyMarkdown = [
  "| Consumer | Allowed direct workspace dependencies |",
  "| --- | --- |",
  "| `@coinzilla/app` | `@coinzilla/brokers`, `@coinzilla/entities` |",
  "| `@coinzilla/utils` | None |",
  "",
].join("\n")

test("parses allowed workspace dependencies and explicit empty policies", () => {
  assert.deepEqual(
    parseWorkspaceDependencyPolicy({ markdown: policyMarkdown }),
    {
      "@coinzilla/app": ["@coinzilla/brokers", "@coinzilla/entities"],
      "@coinzilla/utils": [],
    },
    "The canonical Markdown allowlist must become a deterministic package-to-dependencies map.",
  )
})

test("rejects a missing or malformed policy table", () => {
  assert.throws(
    () => parseWorkspaceDependencyPolicy({ markdown: "| Consumer | Other |\n| --- | --- |\n" }),
    /Canonical workspace dependency policy table header is missing/,
    "A changed or missing table header must fail closed.",
  )

  assert.throws(
    () => parseWorkspaceDependencyPolicy({
      markdown: [
        "| Consumer | Allowed direct workspace dependencies |",
        "| --- | --- |",
        "| `@coinzilla/app` | @coinzilla/brokers |",
      ].join("\n"),
    }),
    /Malformed workspace dependency policy row/,
    "An unparseable package row must not be silently skipped.",
  )
})

test("rejects duplicate consumers and duplicate dependency entries", () => {
  assert.throws(
    () => parseWorkspaceDependencyPolicy({
      markdown: [
        "| Consumer | Allowed direct workspace dependencies |",
        "| --- | --- |",
        "| `@coinzilla/app` | None |",
        "| `@coinzilla/app` | None |",
      ].join("\n"),
    }),
    /Duplicate workspace dependency policy consumer: @coinzilla\/app/,
    "Duplicate consumer rows must fail rather than overwrite one another.",
  )

  assert.throws(
    () => parseWorkspaceDependencyPolicy({
      markdown: [
        "| Consumer | Allowed direct workspace dependencies |",
        "| --- | --- |",
        "| `@coinzilla/app` | `@coinzilla/utils`, `@coinzilla/utils` |",
      ].join("\n"),
    }),
    /Duplicate allowed workspace dependency: @coinzilla\/utils/,
    "Duplicate allowlist edges must be rejected.",
  )
})

test("rejects self-dependencies and invalid package names", () => {
  assert.throws(
    () => parseWorkspaceDependencyPolicy({
      markdown: [
        "| Consumer | Allowed direct workspace dependencies |",
        "| --- | --- |",
        "| `@coinzilla/app` | `@coinzilla/app` |",
      ].join("\n"),
    }),
    /Workspace dependency policy cannot allow a package to depend on itself/,
    "A self-edge is not a meaningful allowlist entry.",
  )

  assert.throws(
    () => parseWorkspaceDependencyPolicy({
      markdown: [
        "| Consumer | Allowed direct workspace dependencies |",
        "| --- | --- |",
        "| `@other/app` | None |",
      ].join("\n"),
    }),
    /Malformed workspace dependency policy row/,
    "Policy rows must identify a valid @coinzilla workspace package.",
  )
})
