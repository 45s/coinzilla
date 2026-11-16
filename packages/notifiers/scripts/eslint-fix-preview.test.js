import { ESLint } from "eslint"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

test("prints the ESLint autofix output for package files without writing them", async () => {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    fix: true,
  })
  const results = await eslint.lintFiles(["packages/notifiers"])

  for (const result of results) {
    if (result.output) {
      const filePath = relative(repositoryRoot, result.filePath)
      const encodedOutput = Buffer.from(result.output).toString("base64")
      process.stdout.write(`ESLINT_FIX ${filePath} ${encodedOutput}\n`)
    }
  }
})
