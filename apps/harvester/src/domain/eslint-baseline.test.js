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
  const findings = [];
  for (const result of results) {
    for (const message of result.messages) {
      findings.push({
        file: result.filePath.replace(process.cwd() + "/", ""),
        line: message.line,
        column: message.column,
        rule: message.ruleId ?? "fatal",
        severity: message.severity,
        message: message.message,
      });
    }
  }

  assert.deepEqual(findings, [], JSON.stringify(findings));
});
