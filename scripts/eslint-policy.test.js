import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);
const qualityWorkflow = await readFile(
  resolve(repositoryRoot, ".github/workflows/quality-gate.yml"),
  "utf8",
);

test("workspace lint rejects every error and warning", () => {
  assert.equal(
    packageJson.scripts.lint,
    "eslint . --max-warnings 0",
    "The canonical lint command must cover the workspace and reject warnings.",
  );
});

test("the required JavaScript quality gate runs strict workspace lint", () => {
  assert.match(
    qualityWorkflow,
    /- name: Enforce zero-warning full-workspace ESLint\s+run: pnpm lint/,
    "The required JavaScript quality workflow must run the canonical strict lint command.",
  );
});

test("the root package exposes no baseline-tolerant lint commands", () => {
  assert.equal(Object.hasOwn(packageJson.scripts, "lint:changed"), false);
  assert.equal(Object.hasOwn(packageJson.scripts, "lint:report"), false);
});

test("the full workspace satisfies a complexity threshold of 15", async () => {
  const eslint = new ESLint({
    overrideConfig: [
      {
        rules: {
          complexity: ["error", { max: 15 }],
        },
      },
    ],
  });
  const results = await eslint.lintFiles(["."]);
  const findings = results.flatMap((result) => result.messages
    .filter((message) => message.ruleId === "complexity")
    .map((message) => ({
      filePath: result.filePath,
      line: message.line,
      message: message.message,
    })));

  assert.deepEqual(
    findings,
    [],
    "The workspace must remain within complexity 15 without suppressions or file exclusions.",
  );
});
