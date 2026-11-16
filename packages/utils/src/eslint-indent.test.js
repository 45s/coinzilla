import assert from "node:assert/strict"
import { basename, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const eslintModule = await import("eslint").catch(() => null)
const ESLint = eslintModule?.ESLint

test("exports corrected object indentation for the Utilities package", {
  skip: !ESLint,
}, async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))
  const eslint = new ESLint({
    cwd: repositoryRoot,
    fix: true,
    overrideConfig: [{ rules: { indent: ["error", 2, { ObjectExpression: 2 }] } }],
  })
  const results = await eslint.lintFiles(["packages/utils/**/*.{js,mjs,cjs}"])
  const fixedFiles = results.filter((result) => (
    result.output !== undefined &&
    !["eslint-inventory.test.js", "eslint-indent.test.js"].includes(basename(result.filePath))
  ))

  for (const result of fixedFiles) {
    process.stdout.write(`UTILS_ESLINT_INDENT ${JSON.stringify({
      path: relative(repositoryRoot, result.filePath),
      content: result.output,
    })}\\n`)
  }

  assert.ok(results.length > 0, "ESLint must inspect JavaScript files throughout packages/utils")
})
