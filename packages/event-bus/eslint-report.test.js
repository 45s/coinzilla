import assert from "node:assert/strict"
import { relative } from "node:path"
import test from "node:test"
import { ESLint } from "eslint"

function groupMessages(messages) {
  const rules = new Map()

  for (const message of messages) {
    const ruleId = message.ruleId ?? "fatal"
    const findings = rules.get(ruleId) ?? []
    findings.push({
      line: message.line ?? 0,
      column: message.column ?? 0,
      severity: message.severity === 2 ? "error" : "warning",
      message: message.message,
    })
    rules.set(ruleId, findings)
  }

  return [...rules.entries()]
    .map(([ruleId, findings]) => ({
      ruleId,
      count: findings.length,
      findings,
    }))
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
}

function createFileReport(result) {
  return {
    file: relative(process.cwd(), result.filePath),
    errors: result.errorCount,
    warnings: result.warningCount,
    rules: groupMessages(result.messages),
  }
}

test("prints a complete package ESLint report grouped by file and rule", async () => {
  const eslint = new ESLint()
  const results = await eslint.lintFiles(["src/**/*.{js,mjs,cjs}"])
  const files = results
    .map(createFileReport)
    .sort((left, right) => left.file.localeCompare(right.file))
  const report = {
    fileCount: results.length,
    errorCount: results.reduce((total, result) => total + result.errorCount, 0),
    warningCount: results.reduce((total, result) => total + result.warningCount, 0),
    files,
  }

  process.stdout.write(`EVENT_BUS_ESLINT_REPORT_START\n${JSON.stringify(report, null, 2)}\nEVENT_BUS_ESLINT_REPORT_END\n`)
  assert.ok(results.length > 0, "The package ESLint report must inspect JavaScript files.")

  const fixer = new ESLint({ fix: true })
  const fixedResults = await fixer.lintFiles(["src/**/*.{js,mjs,cjs}"])
  const fixedFiles = fixedResults
    .filter((result) => typeof result.output === "string")
    .map((result) => ({
      file: relative(process.cwd(), result.filePath),
      content: result.output,
    }))
  process.stdout.write(`EVENT_BUS_ESLINT_AUTOFIX_START\n${JSON.stringify(fixedFiles)}\nEVENT_BUS_ESLINT_AUTOFIX_END\n`)
})
