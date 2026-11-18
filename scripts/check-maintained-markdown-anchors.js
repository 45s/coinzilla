import { fileURLToPath } from "node:url"
import process from "node:process"

import {
  findMarkdownDocuments,
  findMissingLocalAnchors,
} from "./check-agent-policy.js"
import { isHistoricalPath } from "./markdown-path-policy.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

/**
 * Return unresolved local heading references whose source document is maintained.
 *
 * Historical targets remain valid link targets; only the source path determines
 * whether an unresolved reference blocks the repository.
 *
 * @param {{root: string, documents: {path: string, content: string}[]}} options Repository root and discovered documents.
 * @returns {string[]} Blocking findings from maintained source documents.
 */
export function findMissingMaintainedLocalAnchors({ root, documents }) {
  const historicalPrefixes = documents
    .filter(({ path }) => isHistoricalPath(path))
    .map(({ path }) => `${path} `)
  return findMissingLocalAnchors(root, documents).filter(
    (finding) => !historicalPrefixes.some((prefix) => finding.startsWith(prefix)),
  )
}

/**
 * Enforce local heading anchors for maintained Markdown while reporting historical gaps.
 *
 * @returns {{scannedFiles: number, maintainedGaps: string[], historicalGaps: string[]}}
 */
export function checkMaintainedLocalAnchors() {
  const documents = findMarkdownDocuments(repositoryRoot)
  const allGaps = findMissingLocalAnchors(repositoryRoot, documents)
  const maintainedGaps = findMissingMaintainedLocalAnchors({
    root: repositoryRoot,
    documents,
  })
  const historicalGaps = allGaps.filter((finding) => !maintainedGaps.includes(finding))

  process.stdout.write(
    `Local heading anchors: ${maintainedGaps.length} maintained-source findings (blocking); ${historicalGaps.length} historical-source findings (report-only) across ${documents.length} Markdown/MDX files.\n`,
  )

  for (const finding of historicalGaps) {
    process.stdout.write(`- REPORT-ONLY: ${finding}\n`)
  }

  if (maintainedGaps.length > 0) {
    for (const finding of maintainedGaps) {
      process.stderr.write(`- BLOCKING: ${finding}\n`)
    }
    throw new Error("Maintained Markdown local heading-anchor check failed")
  }

  process.stdout.write("Maintained Markdown local heading anchors pass.\n")
  return {
    scannedFiles: documents.length,
    maintainedGaps,
    historicalGaps,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkMaintainedLocalAnchors()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
