import { ESLint } from "eslint"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url))

test("prints safe ESLint autofixes for review", async () => {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    fix: true,
  })
  const results = await eslint.lintFiles([
    "apps/harvester/src/use-cases/**/*.js",
  ])

  for (const result of results) {
    if (typeof result.output !== "string") {
      continue
    }
    const relativePath = result.filePath.slice(repositoryRoot.length).replaceAll("\\", "/")
    const encodedSource = Buffer.from(result.output, "utf8").toString("base64")
    process.stdout.write(`ESLINT_AUTOFIX_SOURCE:${relativePath}:${encodedSource}\n`)
  }
})
