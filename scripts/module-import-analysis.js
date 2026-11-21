import { Linter } from "eslint"

const captureModuleImports = ({ imports }) => ({
  create() {
    const recordImport = (node, kind) => {
      imports.push({
        specifier: node.value,
        kind,
      })
    }

    return {
      ImportDeclaration(node) {
        recordImport(node.source, "import")
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          recordImport(node.source, "re-export")
        }
      },
      ExportAllDeclaration(node) {
        recordImport(node.source, "re-export")
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          recordImport(node.source, "dynamic-import")
        }
      },
      CallExpression(node) {
        const [argument] = node.arguments
        const isLiteralRequire = (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          argument?.type === "Literal" &&
          typeof argument.value === "string"
        )

        if (isLiteralRequire) {
          recordImport(argument, "require")
        }
      },
    }
  },
})

/**
 * Extract statically resolvable module specifiers from JavaScript source.
 *
 * This uses ESLint's configured JavaScript parser and records only literal
 * specifiers. Computed imports and non-literal require calls are intentionally
 * excluded because their targets cannot be resolved without executing code.
 *
 * @param {{file: string, source: string}} options
 * @returns {Array<{specifier: string, kind: string}>}
 * @throws {SyntaxError} If the source cannot be parsed as JavaScript.
 */
export function extractModuleImports({ file, source }) {
  const imports = []
  const linter = new Linter()
  const messages = linter.verify(source, {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      capture: {
        rules: {
          imports: captureModuleImports({ imports }),
        },
      },
    },
    rules: {
      "capture/imports": "error",
    },
  })
  const parseError = messages.find(({ fatal }) => fatal)

  if (parseError) {
    throw new SyntaxError(
      `${file}:${parseError.line}:${parseError.column} ${parseError.message}`,
    )
  }

  return imports
}
