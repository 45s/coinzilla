import assert from "node:assert/strict";
import test from "node:test";

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


import { ESLint } from "eslint";

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
