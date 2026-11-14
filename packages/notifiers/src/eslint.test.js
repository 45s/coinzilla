import assert from "node:assert/strict"
import test from "node:test"
import { ESLint } from "eslint"
import { fileURLToPath } from "node:url"

test("every notifier JavaScript file passes the repository ESLint configuration", async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  })
  const results = await eslint.lintFiles(["**/*.js"])
  const findings = results.flatMap((result) => result.messages.map((message) => ({
    filePath: result.filePath,
    line: message.line,
    column: message.column,
    severity: message.severity === 2 ? "error" : "warning",
    ruleId: message.ruleId,
    message: message.message,
  })))

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript source, test, and script in @coinzilla/notifiers must pass ESLint.",
  )
})
