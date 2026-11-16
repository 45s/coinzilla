import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url))

test("passes ESLint for every JavaScript file in the Harvester use-cases directory", async () => {
  const eslint = new ESLint({
    cwd: repositoryRoot,
  })
  const results = await eslint.lintFiles([
    "apps/harvester/src/use-cases/**/*.js",
  ])
  const findings = results.flatMap(({ filePath, messages }) =>
    messages.map(({ ruleId, severity, line, column, message }) => ({
      file: filePath.slice(repositoryRoot.length).replaceAll("\\", "/"),
      rule: ruleId ?? "fatal",
      severity: severity === 2 ? "error" : "warning",
      line,
      column,
      message,
    })),
  )
  const findingCounts = new Map()
  for (const finding of findings) {
    const key = `${finding.file} :: ${finding.rule}`
    findingCounts.set(key, (findingCounts.get(key) ?? 0) + 1)
  }
  const findingSummary = [...findingCounts]
    .map(([key, count]) => `${count} ${key}`)
    .sort()
    .join("\n")

  assert.equal(
    findings.length,
    0,
    `Found ${findings.length} ESLint findings in apps/harvester/src/use-cases/:\n${findingSummary}`,
  )
})
