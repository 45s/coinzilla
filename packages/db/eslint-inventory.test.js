import { ESLint } from "eslint"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))

test("reports every existing ESLint finding in the database package", async () => {
  const eslint = new ESLint({ cwd: repositoryRoot })
  const results = await eslint.lintFiles(["packages/db"])
  const groupedFindings = new Map()

  for (const result of results) {
    const filePath = relative(repositoryRoot, result.filePath)
    for (const message of result.messages) {
      const ruleId = message.ruleId ?? "fatal"
      const key = `${filePath}::${ruleId}`
      const group = groupedFindings.get(key) ?? {
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
      groupedFindings.set(key, group)
    }
  }

  const report = [...groupedFindings.values()].sort((left, right) => (
    left.filePath.localeCompare(right.filePath)
    || left.ruleId.localeCompare(right.ruleId)
  ))
  console.log(JSON.stringify({
    filesScanned: results.length,
    filesWithFindings: new Set(report.map(({ filePath }) => filePath)).size,
    findingCount: report.reduce((total, group) => total + group.count, 0),
    groupedFindings: report,
  }, null, 2))
})
