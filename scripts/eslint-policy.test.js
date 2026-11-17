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

test("the workspace complexity policy retains its evidence-based threshold", async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile("apps/harvester/src/index.js");

  assert.deepEqual(
    config.rules.complexity,
    [2, { max: 20 }],
    "Do not lower complexity to 15 while the workspace has a broad existing cleanup burden.",
  );
});
