import { posix } from "node:path"

const SOURCE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"])
const INDEX_FILENAMES = Object.freeze(["index.js", "index.mjs", "index.cjs"])

const normalizeRepositoryPath = ({ path }) => path.replaceAll("\\", "/")

const isRelativeModuleSpecifier = ({ specifier }) => (
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../")
)

/**
 * Resolve a relative module specifier to a known repository JavaScript source file.
 *
 * Extensionless resolution prefers .js, then .mjs, then .cjs, followed by the
 * same index filenames. Non-relative, unresolved, asset, and root-escaping
 * specifiers return null and are not added to a source-module graph.
 *
 * @param {{importerPath: string, specifier: string, sourceFiles: string[]}} options
 * @returns {string|null} Repository-relative source path, or null when unresolved.
 */
export function resolveRelativeModuleImport({ importerPath, specifier, sourceFiles }) {
  if (!isRelativeModuleSpecifier({ specifier })) {
    return null
  }

  const normalizedImporterPath = normalizeRepositoryPath({ path: importerPath })
  const normalizedSpecifier = normalizeRepositoryPath({ path: specifier })
  const resolvedPath = posix.normalize(
    posix.join(posix.dirname(normalizedImporterPath), normalizedSpecifier),
  )

  if (resolvedPath === ".." || resolvedPath.startsWith("../") || resolvedPath.startsWith("/")) {
    return null
  }

  const hasExplicitExtension = Boolean(posix.extname(resolvedPath))
  const candidates = hasExplicitExtension
    ? [resolvedPath]
    : [
      ...SOURCE_EXTENSIONS.map((extension) => `${resolvedPath}${extension}`),
      ...INDEX_FILENAMES.map((filename) => posix.join(resolvedPath, filename)),
    ]
  const availableSourceFiles = new Set(
    sourceFiles.map((path) => normalizeRepositoryPath({ path })),
  )

  return candidates.find((candidate) => availableSourceFiles.has(candidate)) ?? null
}
