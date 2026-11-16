import assert from "node:assert/strict"
import { relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url))

test("keeps every application-layer JavaScript file free of ESLint errors and warnings", async () => {
  const autofixResults = await new ESLint({
    cwd: workspaceRoot,
    fix: true,
    overrideConfig: [{ rules: { indent: ["error", 2, { ignoredNodes: ["TemplateLiteral"] }], "object-curly-newline": ["error", { ObjectExpression: { minProperties: 2 } }] } }],
  }).lintFiles(["apps/harvester/src/application"])
  for (const result of autofixResults) {
    if (typeof result.output === "string") {
      process.stderr.write(`\nAPPLICATION_ESLINT_AUTOFIX_BEGIN:${relative(workspaceRoot, result.filePath)}\n`)
      process.stderr.write(result.output)
      process.stderr.write("\nAPPLICATION_ESLINT_AUTOFIX_END\n")
    }
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
    process.stderr.write(`Application ESLint findings (${findings.length}):\\n`)
    process.stderr.write(`${JSON.stringify(findings, null, 2)}\\n`)
  }

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript file in apps/harvester/src/application must have zero ESLint errors and warnings.",
  )
})
