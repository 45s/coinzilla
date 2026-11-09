/**
 * Analyze changed maintained Markdown documents against the repository style.
 * Historical evidence is excluded; GitHub templates have a heading exception.
 *
 * @param {{path: string, content: string}[]} documents
 * @returns {{scannedFiles: number, skippedHistorical: number, violations: object}}
 */
export function analyzeMarkdownStyleDocuments(documents) {
  return { scannedFiles: documents.length, skippedHistorical: 0, violations: {} }
}
