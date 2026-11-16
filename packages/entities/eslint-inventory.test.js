import { ESLint } from "eslint";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

function summarizeResults(results) {
  const files = [];
  const ruleCounts = new Map();
  let errors = 0;
  let warnings = 0;

  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
    if (result.messages.length === 0) {
      continue;
    }

    const messages = [];
    for (const message of result.messages) {
      const ruleId = message.ruleId ?? "unknown";
      ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + 1);
      messages.push({
        ruleId,
        severity: message.severity === 2 ? "error" : "warning",
        line: message.line,
        column: message.column,
        message: message.message,
      });
    }

    files.push({
      file: relative(packageRoot, result.filePath),
      errors: result.errorCount,
      warnings: result.warningCount,
      messages,
    });
  }

  const byRule = [];
  for (const [ruleId, count] of ruleCounts) {
    byRule.push({ ruleId, count });
  }

  return {
    scannedFiles: results.length,
    filesWithFindings: files.length,
    errors,
    warnings,
    byRule,
    byFile: files,
  };
}

test("reports remaining ESLint findings for @coinzilla/entities", async () => {
  const eslint = new ESLint({ cwd: packageRoot });
  const results = await eslint.lintFiles(["**/*.{js,mjs,cjs}"]);
  const summary = summarizeResults(results);

  process.stdout.write(`ENTITIES_ESLINT_REMAINING\n${JSON.stringify(summary, null, 2)}\n`);
});
