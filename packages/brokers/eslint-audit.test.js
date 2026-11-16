import assert from "node:assert/strict";
import { ESLint } from "eslint";
import test from "node:test";

test("all Brokers package JavaScript files satisfy repository ESLint rules", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["."]);
  const findings = results.flatMap((result) =>
    result.messages.map((message) => ({
      filePath: result.filePath,
      line: message.line,
      column: message.column,
      ruleId: message.ruleId,
      severity: message.severity,
      message: message.message,
    })),
  );

  assert.equal(
    findings.length,
    0,
    `Brokers package ESLint violations:\n${findings
      .map(
        (finding) =>
          `${finding.filePath}:${finding.line}:${finding.column} ${finding.ruleId ?? "fatal"}: ${finding.message}`,
      )
      .join("\n")}`,
  );
});
