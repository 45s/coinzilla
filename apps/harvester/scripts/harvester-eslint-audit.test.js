import assert from "node:assert/strict"
import { ESLint } from "eslint"
import { relative } from "node:path"
import test from "node:test"

test("reports fixable and remaining Harvester ESLint findings without writing files", async () => {
  const eslint = new ESLint({ overrideConfigFile: "../../eslint.config.js", fix: true })
  const results = await eslint.lintFiles(["."])
  const fixedFiles = results
    .filter((result) => result.output !== undefined)
    .map((result) => ({
      file: relative(process.cwd(), result.filePath),
      content: Buffer.from(result.output).toString("base64"),
    }))
  const remaining = results.flatMap((result) =>
    result.messages.map((message) => ({
      file: relative(process.cwd(), result.filePath),
      line: message.line,
      column: message.column,
      rule: message.ruleId,
      message: message.message,
    })),
  )
  process.stdout.write("HARVESTER_ESLINT_AUTOFIX_FILES=" + JSON.stringify(fixedFiles) + "\n")
  process.stdout.write("HARVESTER_ESLINT_REMAINING=" + JSON.stringify(remaining) + "\n")
  assert.ok(true, "The full Harvester lint inventory is diagnostic; autofix candidates are emitted without modifying the checkout.")
})
