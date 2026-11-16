import assert from "node:assert/strict"
import { ESLint } from "eslint"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

test("reports zero ESLint findings across the complete notifiers package", async () => {
  const eslint = new ESLint({ cwd: repositoryRoot })
  const results = await eslint.lintFiles(["packages/notifiers"])
  const groups = new Map()

  for (const result of results) {
    const filePath = relative(repositoryRoot, result.filePath)
    for (const message of result.messages) {
      const ruleId = message.ruleId ?? "fatal"
      const key = `${filePath}::${ruleId}`
      const group = groups.get(key) ?? {
        filePath,
        ruleId,
        count: 0,
        findings: [],
      }
      group.count += 1
      group.findings.push({
        line: message.line,
        column: message.column,
        severity: message.severity === 2 ? "error" : "warning",
        message: message.message,
      })
      groups.set(key, group)
    }
  }

  const groupedFindings = [...groups.values()]
  let findingCount = 0
  for (const group of groupedFindings) {
    findingCount += group.count
  }
  const filesWithFindings = new Set(groupedFindings.map(({ filePath }) => filePath))

  process.stdout.write(`${JSON.stringify({
    filesScanned: results.length,
    filesWithFindings: filesWithFindings.size,
    findingCount,
    groupedFindings,
  }, null, 2)}\n`)
  assert.equal(
    findingCount,
    0,
    "Every JavaScript file in the notifiers package must pass the effective root ESLint configuration.",
  )
})
