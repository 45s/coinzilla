import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("Harvester domain source has no ESLint violations", () => {
  const output = execFileSync(
    "pnpm",
    ["exec", "eslint", "src/domain", "--format", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const results = JSON.parse(output);
  const findings = results.flatMap((result) =>
    result.messages.map((message) => ({
      file: result.filePath,
      rule: message.ruleId,
      severity: message.severity,
      line: message.line,
      message: message.message,
    })),
  );

  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
