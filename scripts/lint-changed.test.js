import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createStrictESLint, getChangedFiles } from "./lint-changed.js";

// These integration tests deliberately use the root canonical ESLint configuration.

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);

function git({ cwd, args }) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createRepository() {
  const cwd = await mkdtemp(join(tmpdir(), "coinzilla-eslint-changed-"));
  git({
    cwd,
    args: ["init", "-b", "main"],
  });
  git({
    cwd,
    args: ["config", "user.name", "ESLint test"],
  });
  git({
    cwd,
    args: ["config", "user.email", "eslint-test@example.invalid"],
  });
  return cwd;
}

async function commitFile({ cwd, path, source }) {
  const absolutePath = join(cwd, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source);
  git({
    cwd,
    args: ["add", "--", path],
  });
  git({
    cwd,
    args: ["commit", "-m", "fixture"],
  });
}

async function withRepository({ callback }) {
  const cwd = await createRepository();
  try {
    await callback(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function lintStrict({ source, fileName = "scripts/strict-fixture.js" }) {
  const eslint = createStrictESLint({ cwd: repositoryRoot });
  const [result] = await eslint.lintText(source, { filePath: fileName });
  return result.messages;
}

function hasRule({ messages, ruleId }) {
  return messages.some((message) => message.ruleId === ruleId && message.severity === 2);
}

test("strict policy inherits the canonical workspace rules and overrides only approved thresholds", async () => {
  const { ESLint } = await import("eslint");
  const workspace = new ESLint({ cwd: repositoryRoot });
  const strict = createStrictESLint({ cwd: repositoryRoot });
  const [workspaceConfig, strictConfig] = await Promise.all([
    workspace.calculateConfigForFile("scripts/eslint-policy.test.js"),
    strict.calculateConfigForFile("scripts/eslint-policy.test.js"),
  ]);

  assert.deepEqual(workspaceConfig.rules.complexity, [2, { max: 20 }], "The existing workspace complexity threshold must remain 20.");
  assert.deepEqual(strictConfig.rules.complexity, [2, { max: 15 }], "Changed files must use complexity 15.");
  assert.deepEqual(strictConfig.rules["max-params"], [2, 1], "Both policies must retain the one-parameter limit.");
  assert.deepEqual(strictConfig.rules["max-lines-per-function"], [
    2,
    {
      max: 60,
      skipBlankLines: true,
      skipComments: true,
    },
  ], "Changed files must use the strict 60-line limit.");
  assert.deepEqual(strictConfig.rules["max-statements"], [2, 30], "Changed files must use the strict 30-statement limit.");
  assert.deepEqual(strictConfig.rules["max-depth"], [2, 3], "Changed files must use the strict three-level nesting limit.");
  assert.deepEqual(strictConfig.rules["max-nested-callbacks"], [2, 2], "Changed files must use the strict two-level callback limit.");
  assert.deepEqual(strictConfig.rules.eqeqeq, workspaceConfig.rules.eqeqeq, "Unrelated canonical rules must be inherited unchanged.");
  assert.deepEqual(strictConfig.languageOptions.globals, workspaceConfig.languageOptions.globals, "Canonical runtime globals must be inherited unchanged.");
});

test("a new file within every strict threshold passes", async () => {
  const messages = await lintStrict({
    source: "export function add(value) {\n  return value + 1;\n}\n",
  });
  assert.equal(messages.length, 0, "A small, single-parameter function must pass the strict changed-file policy.");
});

test("strict lint rejects complexity above 15", async () => {
  const cases = [...Array(16).keys()].map((index) => `case ${index}: return ${index};`).join("\n");
  const messages = await lintStrict({
    source: `export function choose(value) {\n  switch (value) {\n    ${cases}\n    default: return -1;\n  }\n}\n`,
  });
  assert.ok(hasRule({ messages, ruleId: "complexity" }), "A function with sixteen independent switch paths must fail complexity 15.");
});

test("strict lint rejects functions longer than 60 counted lines", async () => {
  const body = [...Array(62).keys()].map((index) => `  const value${index} = ${index};`).join("\n");
  const messages = await lintStrict({
    source: `export function longFunction() {\n${body}\n  return value0;\n}\n`,
  });
  assert.ok(hasRule({ messages, ruleId: "max-lines-per-function" }), "A function with more than sixty nonblank, noncomment lines must fail.");
});

test("strict lint rejects more than 30 statements", async () => {
  const body = [...Array(31).keys()].map((index) => `  const value${index} = ${index};`).join("\n");
  const messages = await lintStrict({
    source: `export function manyStatements() {\n${body}\n  return value0;\n}\n`,
  });
  assert.ok(hasRule({ messages, ruleId: "max-statements" }), "A function with more than thirty statements must fail.");
});

test("strict lint rejects four nested control-flow blocks", async () => {
  const messages = await lintStrict({
    source: `export function nested(a, b, c, d) {\n  if (a) {\n    if (b) {\n      if (c) {\n        if (d) {\n          return true;\n        }\n      }\n    }\n  }\n  return false;\n}\n`,
  });
  assert.ok(hasRule({ messages, ruleId: "max-depth" }), "Four nested control-flow blocks must fail the strict depth limit of three.");
});

test("strict lint rejects three nested callbacks", async () => {
  const messages = await lintStrict({
    source: "setTimeout(() => {\n  setTimeout(() => {\n    setTimeout(() => {}, 0);\n  }, 0);\n}, 0);\n",
  });
  assert.ok(hasRule({ messages, ruleId: "max-nested-callbacks" }), "Three nested callbacks must fail the strict callback limit of two.");
});

test("a strict violation in an untouched legacy file is not selected", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "legacy.js",
        source: "export function old() { return 1; }\n",
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, [], "An unchanged legacy file must not enter the changed-file lint set.");
    },
  });
});

test("a modified existing file with a strict violation is selected and rejected", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "legacy.js",
        source: "export function old() { return 1; }\n",
      });
      const cases = [...Array(16).keys()].map((index) => `case ${index}: return ${index};`).join("\n");
      const changedSource = `export function changed(value) { switch (value) { ${cases} default: return -1; } }\n`;
      await writeFile(join(cwd, "legacy.js"), changedSource);
      git({
        cwd,
        args: ["add", "--", "legacy.js"],
      });
      git({
        cwd,
        args: ["commit", "-m", "modify legacy file"],
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, ["legacy.js"], "A modified legacy file must be selected in full.");
      const messages = await lintStrict({ source: changedSource });
      assert.ok(hasRule({ messages, ruleId: "complexity" }), "A strict violation anywhere in the modified file must fail.");
    },
  });
});

test("renamed files select the destination path", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "before.js",
        source: "export const value = 1;\n",
      });
      git({
        cwd,
        args: ["mv", "before.js", "after.mjs"],
      });
      git({
        cwd,
        args: ["commit", "-m", "rename file"],
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, ["after.mjs"], "A renamed JavaScript file must be linted at its new path.");
    },
  });
});

test("deleted files are excluded", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "removed.cjs",
        source: "module.exports = 1;\n",
      });
      git({
        cwd,
        args: ["rm", "removed.cjs"],
      });
      git({
        cwd,
        args: ["commit", "-m", "delete file"],
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, [], "Deleted JavaScript files must never be passed to ESLint.");
    },
  });
});

test("filenames containing spaces are handled without line parsing", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "file with spaces.js",
        source: "export const value = 1;\n",
      });
      await writeFile(join(cwd, "file with spaces.js"), "export const value = 2;\n");
      git({
        cwd,
        args: ["add", "--", "file with spaces.js"],
      });
      git({
        cwd,
        args: ["commit", "-m", "modify spaced path"],
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, ["file with spaces.js"], "A valid path containing spaces must remain one selected filename.");
    },
  });
});

test("an empty changed-file set succeeds", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "unchanged.js",
        source: "export const value = 1;\n",
      });
      const files = await getChangedFiles({ cwd, baseRef: "main", headRef: "HEAD" });
      assert.deepEqual(files, [], "No changed JavaScript files must produce a successful empty selection.");
    },
  });
});

test("missing or invalid merge-base information fails closed", async () => {
  await withRepository({
    callback: async (cwd) => {
      await commitFile({
        cwd,
        path: "file.js",
        source: "export const value = 1;\n",
      });
      await assert.rejects(
        getChangedFiles({ cwd, baseRef: "missing-base", headRef: "HEAD" }),
        /merge base|base ref|not found/i,
        "An unavailable base ref must produce an actionable error instead of skipping lint.",
      );
    },
  });
});

test("the existing workspace lint command and workflow remain independent", async () => {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const workflow = await readFile(join(repositoryRoot, ".github/workflows/quality-gate.yml"), "utf8");
  assert.equal(packageJson.scripts.lint, "eslint . --max-warnings 0", "The canonical full-workspace lint script must remain byte-for-byte unchanged.");
  assert.match(workflow, /name: Enforce zero-warning full-workspace ESLint\s+run: pnpm lint/, "The existing full-workspace CI step must remain present.");
});
