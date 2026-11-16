import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { relative } from "node:path";

test("infrastructure ESLint baseline is clean", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["src/infrastructure"]);
  const findings = results
    .filter((result) => result.errorCount > 0 || result.warningCount > 0)
    .map((result) => {
      const rules = {};
      for (const message of result.messages) {
        const rule = message.ruleId ?? "fatal";
        rules[rule] = (rules[rule] ?? 0) + 1;
      }
      return {
        file: relative(process.cwd(), result.filePath),
        errors: result.errorCount,
        warnings: result.warningCount,
        rules,
      };
    });
  const errorCount = findings.reduce((total, file) => total + file.errors, 0);
  const warningCount = findings.reduce((total, file) => total + file.warnings, 0);

  assert.equal(
    errorCount + warningCount,
    0,
    JSON.stringify({ filesWithFindings: findings.length, errorCount, warningCount, findings }, null, 2),
  );
});
