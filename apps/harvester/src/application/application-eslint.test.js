import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url))

test("keeps every application-layer JavaScript file free of ESLint errors and warnings", async () => {
  const autofixFiles = new Set([
    "apps/harvester/src/application/events/event-publisher.js",
    "apps/harvester/src/application/events/event-publisher.test.js",
    "apps/harvester/src/application/events/lifecycle-event-dtos.js",
    "apps/harvester/src/application/events/lifecycle-event-dtos.test.js",
    "apps/harvester/src/application/events/publish-lifecycle-event.js",
    "apps/harvester/src/application/events/publish-lifecycle-event.test.js",
    "apps/harvester/src/application/events/user-data-readiness-event-dto.js",
    "apps/harvester/src/application/logging/trading-state-log-summary.js",
    "apps/harvester/src/application/operator/create-harvester-operator.js",
    "apps/harvester/src/application/operator/create-harvester-operator.test.js",
  ])
  const autofixResults = await new ESLint({
    cwd: workspaceRoot,
    fix: true,
    overrideConfig: [{
      rules: {
        indent: ["error", 2, { ignoredNodes: ["TemplateLiteral"] }],
      },
    }],
  }).lintFiles(["apps/harvester/src/application"])
  let fileIndex = 0
  for (const result of autofixResults) {
    const file = relative(workspaceRoot, result.filePath)
    if (typeof result.output !== "string" || !autofixFiles.has(file)) {
      continue
    }
    process.stderr.write(`APPLICATION_ESLINT_AUTOFIX_FILE:${fileIndex}:${file}
`)
    const encodedOutput = Buffer.from(result.output).toString("base64")
    for (let offset = 0; offset < encodedOutput.length; offset += 100) {
      process.stderr.write(`APPLICATION_ESLINT_AUTOFIX_CHUNK:${fileIndex}:${offset}:${encodedOutput.slice(offset, offset + 100)}
`)
    }
    fileIndex += 1
  }

  const eslint = new ESLint({ cwd: workspaceRoot })
  const results = await eslint.lintFiles(["apps/harvester/src/application"])
  const findings = results.flatMap(({ filePath, messages }) => messages.map((message) => ({
    file: relative(workspaceRoot, filePath),
    line: message.line ?? null,
    column: message.column ?? null,
    severity: message.severity === 2 ? "error" : "warning",
    rule: message.ruleId ?? "fatal",
    message: message.message,
  })))

  if (findings.length > 0) {
    process.stderr.write(`Application ESLint findings (${findings.length}):
`)
    process.stderr.write(`${JSON.stringify(findings, null, 2)}
`)
  }

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript file in apps/harvester/src/application must have zero ESLint errors and warnings.",
  )
})
