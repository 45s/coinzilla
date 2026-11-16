import { ESLint } from "eslint"
import { createRequire } from "node:module"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(import.meta.url)
const eslintEntry = require.resolve("eslint")
const { parse } = createRequire(eslintEntry)("espree")

function indentObjectProperties(source) {
  const lines = source.split("\n")
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    loc: true,
  })
  const indentationByLine = new Map()

  const objectAncestors = []

  function visit(node) {
    if (!node || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child)
      }
      return
    }

    if (
      (node.type === "ObjectExpression" || node.type === "ObjectPattern") &&
      node.loc
    ) {
      const openingLine = node.loc.start.line
      const openingIndent = lines[openingLine - 1].match(/^\s*/)[0].length
      let sameLineAncestors = 0
      for (const ancestor of objectAncestors) {
        if (ancestor.loc.start.line === openingLine) {
          sameLineAncestors += 1
        }
      }
      const expectedIndent = openingIndent + 2 + (sameLineAncestors * 2)
      for (const property of node.properties) {
        if (property.loc.start.line !== openingLine) {
          const lineIndex = property.loc.start.line - 1
          const existingIndent = indentationByLine.get(lineIndex) ?? 0
          indentationByLine.set(lineIndex, Math.max(existingIndent, expectedIndent))
        }
      }
    }

    const isObjectNode =
      node.type === "ObjectExpression" || node.type === "ObjectPattern"
    if (isObjectNode) {
      objectAncestors.push(node)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "loc" && key !== "range" && key !== "tokens" && key !== "comments") {
        visit(value)
      }
    }
    if (isObjectNode) {
      objectAncestors.pop()
    }
  }

  visit(ast)
  for (const [lineIndex, indentation] of indentationByLine) {
    const line = lines[lineIndex]
    const currentIndent = line.match(/^\s*/)[0].length
    lines[lineIndex] = `${" ".repeat(indentation)}${line.slice(currentIndent)}`
  }

  return lines.join("\n")
}

test("prints correctly indented ESLint autofix output without writing files", async () => {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    fix: true,
  })
  const results = await eslint.lintFiles(["packages/notifiers"])

  for (const result of results) {
    if (result.output) {
      const filePath = relative(repositoryRoot, result.filePath)
      const formattedOutput = indentObjectProperties(result.output)
      const encodedOutput = Buffer.from(formattedOutput).toString("base64")
      process.stdout.write(`ESLINT_FIX ${filePath} ${encodedOutput}\n`)
    }
  }
})
