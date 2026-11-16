import { ESLint } from "eslint"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))

test("reports remaining ESLint findings in the database package", async () => {
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

  let findingCount = 0
  const filesWithFindings = new Set()
  for (const group of groupedFindings.values()) {
    findingCount += group.count
    filesWithFindings.add(group.filePath)
  }

  process.stdout.write(`${JSON.stringify({
    filesScanned: results.length,
    filesWithFindings: filesWithFindings.size,
    findingCount,
    groupedFindings: [...groupedFindings.values()],
  }, null, 2)}\n`)
})
