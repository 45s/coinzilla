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
