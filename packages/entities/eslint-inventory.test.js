import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

function createFileReport(result) {
  return {
    file: relative(packageRoot, result.filePath),
    errors: result.errorCount,
    warnings: result.warningCount,
    messages: result.messages.map((message) => ({
      ruleId: message.ruleId,
      severity: message.severity === 2 ? "error" : "warning",
      line: message.line,
      column: message.column,
      message: message.message,
    })),
  };
}

function summarizeResults(results) {
  const files = results
    .filter(({ messages }) => messages.length > 0)
    .map(createFileReport);
  const ruleCounts = new Map();

  for (const file of files) {
    for (const finding of file.messages) {
      const ruleId = finding.ruleId ?? "unknown";
      ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + 1);
    }
  }

  return {
    scannedFiles: results.length,
    filesWithFindings: files.length,
    errors: results.reduce((total, result) => total + result.errorCount, 0),
    warnings: results.reduce((total, result) => total + result.warningCount, 0),
    byRule: [...ruleCounts.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId)),
    byFile: files,
  };
}

test("reports the complete ESLint inventory for @coinzilla/entities", async () => {
  const eslint = new ESLint({ cwd: packageRoot });
  const results = await eslint.lintFiles(["**/*.{js,mjs,cjs}"]);
  const summary = summarizeResults(results);

  process.stdout.write(`ENTITIES_ESLINT_REPORT\n${JSON.stringify(summary, null, 2)}\n`);
  assert.equal(
    summary.errors + summary.warnings,
    0,
    "The Entities package must have no ESLint errors or warnings after cleanup.",
  );
});
