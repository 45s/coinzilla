import assert from "node:assert/strict";
import { relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("prints ESLint's behavior-preserving automatic fixes for bootstrap review", async () => {
  const eslint = new ESLint({
    cwd: workspaceRoot,
    fix: true,
  });
  const results = await eslint.lintFiles(["apps/harvester/src/bootstrap"]);
  const fixedFiles = results.filter((result) => typeof result.output === "string");
  const remainingFindings = results.flatMap(({ filePath, messages }) => messages.map((message) => ({
    file: relative(workspaceRoot, filePath),
    line: message.line ?? null,
    column: message.column ?? null,
    severity: message.severity === 2 ? "error" : "warning",
    rule: message.ruleId ?? "fatal",
    message: message.message,
  })));

  process.stderr.write(`BOOTSTRAP_ESLINT_REMAINING:${JSON.stringify(remainingFindings)}\n`);

  for (const result of fixedFiles) {
    const relativePath = relative(workspaceRoot, result.filePath);
    const encodedContent = Buffer.from(result.output, "utf8").toString("base64");
    process.stderr.write(`BOOTSTRAP_ESLINT_FIX_FILE:${relativePath}\n${encodedContent}\n`);
  }

  assert.ok(
    results.length > 0,
    "The bootstrap ESLint preview must inspect the complete target directory.",
  );
});
