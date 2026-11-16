import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("apply safe automatic ESLint fixes to Harvester domain files", () => {
  let output;
  try {
    output = execFileSync(
      "pnpm",
      ["exec", "eslint", "src/domain", "--fix", "--format", "json"],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (error) {
    output = error.stdout;
  }

  const results = JSON.parse(output);
  const patches = results
    .filter((result) => typeof result.output === "string")
    .map((result) => ({
      path: result.filePath.replace(process.cwd() + "/", ""),
      content: Buffer.from(result.output).toString("base64"),
    }));
  const findings = results.reduce(
    (total, result) => total + result.errorCount + result.warningCount,
    0,
  );

  console.log("DOMAIN_ESLINT_PATCHES=" + JSON.stringify(patches));
  assert.equal(findings, 0, "Non-autofixable ESLint findings remain: " + findings);
});
