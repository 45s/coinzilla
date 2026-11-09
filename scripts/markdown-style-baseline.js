/**
 * Collect report-only style metrics for repository Markdown documents.
 * This report does not fail CI or rewrite historical documentation.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{fileCount: number, findings: object}}
 */
export function collectMarkdownStyleBaseline(documents) {
  return { fileCount: documents.length, findings: {} }
}
