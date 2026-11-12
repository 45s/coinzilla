import assert from "node:assert/strict"
import { ESLint } from "eslint"
import { relative } from "node:path"
import test from "node:test"

test("reports the existing Harvester ESLint baseline for the scoped source audit", async () => {
  const eslint = new ESLint({ overrideConfigFile: "../../eslint.config.js" })
  const results = await eslint.lintFiles(["."])
  const findings = results.flatMap((result) =>
    result.messages.map((message) => ({
      file: relative(process.cwd(), result.filePath),
      line: message.line,
      column: message.column,
      rule: message.ruleId,
      message: message.message,
    })),
  )
  process.stdout.write("HARVESTER_ESLINT_FINDINGS=" + JSON.stringify(findings) + "\n")
  assert.ok(true, "The full Harvester lint inventory is diagnostic and does not change the legacy lint gate.")
})
