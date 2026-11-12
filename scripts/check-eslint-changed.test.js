import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

import { selectChangedJavaScriptFiles } from "./check-eslint-changed.js";

test("selectChangedJavaScriptFiles keeps JavaScript module extensions", () => {
  const changedFiles = selectChangedJavaScriptFiles([
    "apps/harvester/src/index.js",
    "packages/utils/src/index.mjs",
    "scripts/tool.cjs",
    "docs/guide.md",
    "apps/harvester/config.json",
  ]);

  assert.deepEqual(
    changedFiles,
    [
      "apps/harvester/src/index.js",
      "packages/utils/src/index.mjs",
      "scripts/tool.cjs",
    ],
    "The changed-file gate must include JavaScript files and exclude non-JavaScript files.",
  );
});

test("selectChangedJavaScriptFiles excludes generated and dependency directories", () => {
  const changedFiles = selectChangedJavaScriptFiles([
    "apps/harvester/src/index.js",
    "apps/harvester/dist/generated.js",
    "packages/utils/node_modules/dependency/index.js",
    "packages/db/coverage/report.js",
    "packages/entities/vendor/bundle.js",
    "scripts/generated/build.js",
  ]);

  assert.deepEqual(
    changedFiles,
    ["apps/harvester/src/index.js"],
    "Generated output and dependencies must not enter the changed-source lint gate.",
  );
});

test("selectChangedJavaScriptFiles returns sorted unique paths", () => {
  const changedFiles = selectChangedJavaScriptFiles([
    "scripts/z.js",
    "scripts/a.js",
    "scripts/z.js",
  ]);

  assert.deepEqual(
    changedFiles,
    ["scripts/a.js", "scripts/z.js"],
    "Changed source paths must be deterministic and duplicate-free.",
  );
});


test("ESLint rejects default ESM exports in application and package source files", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    "export default { value: true };\n",
    { filePath: "apps/harvester/config/example.js" },
  );

  assert.ok(
    result.messages.some((message) => message.ruleId === "no-restricted-syntax"),
    "A default ESM export must be rejected by the repository-wide named-export policy.",
  );
});

test("ESLint accepts named exports under the repository export policy", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    "export const value = true;\n",
    { filePath: "apps/harvester/config/example.js" },
  );

  assert.equal(
    result.errorCount,
    0,
    "A valid named ESM export must pass the repository export policy.",
  );
});

test("ESLint permits the loader-required default export in its own configuration file", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    "export default [];\n",
    { filePath: "eslint.config.js" },
  );

  assert.equal(
    result.messages.filter((message) => message.ruleId === "no-restricted-syntax").length,
    0,
    "ESLint's own configuration file must retain the default export required by its config loader.",
  );
});


test("the full workspace contains no ESM default exports outside the ESLint loader configuration", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["**/*.{js,mjs,cjs}"]);
  const violations = results.flatMap((result) => result.messages
    .filter((message) => message.ruleId === "no-restricted-syntax")
    .map((message) => ({
      filePath: result.filePath,
      line: message.line,
      message: message.message,
    })));

  assert.deepEqual(
    violations,
    [],
    "Every workspace ESM module must use named exports; only the root ESLint loader configuration is exempt.",
  );
});


test("ESLint rejects nested ternary operators and accepts explicit branches", async () => {
  const eslint = new ESLint();
  const [nestedTernary] = await eslint.lintText(
    'export const status = enabled ? "ON" : ready ? "READY" : "OFF";\\n',
    { filePath: "apps/harvester/config/nested-ternary-example.js" },
  );
  const [explicitBranches] = await eslint.lintText(
    [
      'export let status = "READY";',
      "if (!enabled) {",
      '  status = "OFF";',
      "} else if (!ready) {",
      '  status = "BLOCKED";',
      "}",
    ].join("\\n"),
    { filePath: "apps/harvester/config/explicit-branches-example.js" },
  );

  assert.ok(
    nestedTernary.messages.some((message) => message.ruleId === "no-nested-ternary"),
    "Nested ternary expressions must be rejected by the repository lint policy.",
  );
  assert.equal(
    explicitBranches.errorCount,
    0,
    "Equivalent explicit if/else branches must pass the repository lint policy.",
  );
});

test("ESLint requires braces around single-statement control-flow bodies", async () => {
  const eslint = new ESLint();
  const [unbracedControlFlow] = await eslint.lintText(
    'export let status = "READY"; if (!enabled) status = "OFF";\\n',
    { filePath: "apps/harvester/config/unbraced-control-flow-example.js" },
  );

  assert.ok(
    unbracedControlFlow.messages.some((message) => message.ruleId === "curly"),
    "Single-statement if bodies must still use braces under the repository lint policy.",
  );
});
