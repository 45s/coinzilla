import assert from "node:assert/strict";
import { relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("keeps every bootstrap JavaScript file free of ESLint errors and warnings", async () => {
  const eslint = new ESLint({ cwd: workspaceRoot });
  const results = await eslint.lintFiles(["apps/harvester/src/bootstrap"]);
  const findings = results.flatMap(({ filePath, messages }) => messages.map((message) => ({
    file: relative(workspaceRoot, filePath),
    line: message.line ?? null,
    column: message.column ?? null,
    severity: message.severity === 2 ? "error" : "warning",
    rule: message.ruleId ?? "fatal",
    message: message.message,
  })));

  if (findings.length > 0) {
    process.stderr.write(`Bootstrap ESLint findings (${findings.length}):\n`);
    process.stderr.write(`${JSON.stringify(findings, null, 2)}\n`);
  }

  assert.deepEqual(
    findings,
    [],
    "Every JavaScript file in apps/harvester/src/bootstrap must have zero ESLint errors and warnings.",
  );
});
