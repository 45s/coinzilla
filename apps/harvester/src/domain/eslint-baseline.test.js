import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("Harvester domain source has no ESLint violations", () => {
  let output;
  try {
    output = execFileSync(
      "pnpm",
      ["exec", "eslint", "src/domain", "--format", "json"],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (error) {
    output = error.stdout;
  }

  const results = JSON.parse(output);
  const files = results
    .map((result) => {
      const rules = new Map();
      for (const message of result.messages) {
        const rule = message.ruleId ?? "fatal";
        rules.set(rule, (rules.get(rule) ?? 0) + 1);
      }
      return {
        file: result.filePath.replace(process.cwd() + "/", ""),
        errors: result.errorCount,
        warnings: result.warningCount,
        rules: Object.fromEntries(rules),
      };
    })
    .filter((result) => result.errors > 0 || result.warnings > 0);

  const summary = {
    files: results.length,
    filesWithFindings: files.length,
    errors: files.reduce((total, file) => total + file.errors, 0),
    warnings: files.reduce((total, file) => total + file.warnings, 0),
    findings: files,
  };

  assert.equal(summary.errors + summary.warnings, 0, JSON.stringify(summary));
});
