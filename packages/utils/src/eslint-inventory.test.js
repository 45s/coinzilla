import assert from "node:assert/strict"
import { test } from "node:test"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"

const eslintModule = await import("eslint").catch(() => null)
const ESLint = eslintModule?.ESLint

test("reports the complete packages/utils ESLint baseline", {
  skip: !ESLint,
}, async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))
  const eslint = new ESLint({ cwd: repositoryRoot })
  const results = await eslint.lintFiles(["packages/utils/**/*.{js,mjs,cjs}"])
  const files = results.map((result) => {
    const rules = {}
    for (const message of result.messages) {
      const rule = message.ruleId ?? "fatal"
      rules[rule] = (rules[rule] ?? 0) + 1
    }

    return {
      path: relative(repositoryRoot, result.filePath),
      errors: result.errorCount,
      warnings: result.warningCount,
      rules,
      messages: result.messages.map((message) => ({
        line: message.line,
        column: message.column,
        rule: message.ruleId ?? "fatal",
        message: message.message,
      })),
    }
  })
  const findings = files.filter((file) => file.errors > 0 || file.warnings > 0)
  let errorCount = 0
  let warningCount = 0
  for (const result of results) {
    errorCount += result.errorCount
    warningCount += result.warningCount
  }
  const report = {
    fileCount: results.length,
    filesWithFindings: findings.length,
    errorCount,
    warningCount,
    byFile: findings,
  }

  process.stdout.write(`PACKAGES_UTILS_ESLINT_BASELINE ${JSON.stringify(report)}\\n`)
  assert.ok(results.length > 0, "ESLint must discover JavaScript files in packages/utils")
})
