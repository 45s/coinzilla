import test from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { relative } from "node:path";

test("Harvester test files have no ESLint errors or warnings", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles(["test"]);

  const findings = results.flatMap((result) => result.messages.map((message) => ({
    filePath: relative(process.cwd(), result.filePath),
    line: message.line,
    column: message.column,
    severity: message.severity === 2 ? "error" : "warning",
    ruleId: message.ruleId,
    message: message.message,
  })));
  const summary = findings.map((finding) => (
    `${finding.filePath}:${finding.line}:${finding.column} ${finding.severity} ${finding.ruleId} ${finding.message}`
  )).join("\n");

  assert.equal(
    findings.length,
    0,
    `Every Harvester test file must satisfy the repository ESLint rules. Remaining findings: ${findings.length}.\n${summary}`,
  );
});
