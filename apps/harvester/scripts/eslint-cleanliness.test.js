import assert from "node:assert/strict"
import path from "node:path"
import { ESLint } from "eslint"
import test from "node:test"

test("every Harvester script satisfies the repository ESLint rules without warnings", async () => {
  const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, ".."), fix: true })
  const results = await eslint.lintFiles(["scripts/**/*.{js,mjs,cjs}"])
  for (const result of results) {
    if (result.output) {
      process.stderr.write("ESLINT_FIXED_FILE:" + path.relative(path.resolve(import.meta.dirname, ".."), result.filePath) + ":" + Buffer.from(result.output).toString("base64") + "\n")
    }
  }

  const findings = results.flatMap((result) => result.messages.map((message) => ({
    file: path.relative(path.resolve(import.meta.dirname, ".."), result.filePath),
    line: message.line,
    column: message.column,
    severity: message.severity === 2 ? "error" : "warning",
    ruleId: message.ruleId,
    message: message.message,
  })))

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write("ESLINT_FINDING:" + JSON.stringify(finding) + "\n")
    }
  }

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript file under apps/harvester/scripts must satisfy all configured ESLint rules. Findings:\n" +
      JSON.stringify(findings, null, 2),
  )
})
