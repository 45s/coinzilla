import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

test("infrastructure ESLint baseline is clean", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["src/infrastructure"]);
  const findings = results
    .filter((result) => result.errorCount > 0 || result.warningCount > 0)
    .map((result) => ({
      filePath: result.filePath,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      messages: result.messages.map((message) => ({
        line: message.line,
        column: message.column,
        ruleId: message.ruleId,
        severity: message.severity,
        message: message.message,
      })),
    }));
  const errorCount = findings.reduce((total, file) => total + file.errorCount, 0);
  const warningCount = findings.reduce((total, file) => total + file.warningCount, 0);

  assert.equal(
    errorCount + warningCount,
    0,
    JSON.stringify({ filesWithFindings: findings.length, errorCount, warningCount, findings }, null, 2),
  );
});
