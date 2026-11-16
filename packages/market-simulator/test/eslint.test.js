import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))

test("all Market Simulator JavaScript files satisfy the repository ESLint rules", async () => {
  const eslint = new ESLint({ cwd: packageRoot })
  const results = await eslint.lintFiles(["src/**/*.js", "test/**/*.js"])
  const findings = results.flatMap((result) => result.messages.map((message) => ({
    filePath: result.filePath,
    line: message.line,
    column: message.column,
    ruleId: message.ruleId,
    severity: message.severity,
    message: message.message,
  })))
  const formattedFindings = findings.map((finding) => {
    const location = `${finding.filePath}:${finding.line}:${finding.column}`
    const rule = finding.ruleId ?? "unknown rule"
    return `${location} [${rule}] ${finding.message}`
  }).join("\n")

  assert.equal(
    findings.length,
    0,
    `Market Simulator ESLint must report zero errors and warnings. Found ${findings.length} findings:\n${formattedFindings}`,
  )
})
