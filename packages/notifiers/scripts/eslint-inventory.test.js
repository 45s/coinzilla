import { ESLint } from "eslint"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

test("reports the complete ESLint inventory for the notifiers package", async () => {
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
  const filesWithFindings = new Set(groupedFindings.map(({ filePath }) => filePath))
  let findingCount = 0
  for (const group of groupedFindings) {
    findingCount += group.count
  }

  process.stdout.write(`${JSON.stringify({
    filesScanned: results.length,
    filesWithFindings: filesWithFindings.size,
    findingCount,
    groupedFindings,
  }, null, 2)}\n`)
})
