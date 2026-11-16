import assert from "node:assert/strict"
import path from "node:path"
import { ESLint } from "eslint"
import test from "node:test"

test("every Harvester script satisfies the repository ESLint rules without warnings", async () => {
  const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, "..") })
  const results = await eslint.lintFiles(["scripts/**/*.{js,mjs,cjs}"])
  const findings = results.flatMap((result) => result.messages.map((message) => ({
    file: path.relative(path.resolve(import.meta.dirname, ".."), result.filePath),
    line: message.line,
    column: message.column,
    severity: message.severity === 2 ? "error" : "warning",
    ruleId: message.ruleId,
    message: message.message,
  })))

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript file under apps/harvester/scripts must satisfy all configured ESLint rules. Findings:\n" +
      JSON.stringify(findings, null, 2),
  )
})
