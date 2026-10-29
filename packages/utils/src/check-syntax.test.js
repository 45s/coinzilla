import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { collectJavaScriptFiles } from "../../../scripts/check-syntax.js";

test("collectJavaScriptFiles recursively returns JavaScript files only", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "coinzilla-syntax-check-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  mkdirSync(join(directory, "nested"));
  writeFileSync(join(directory, "root.js"), "");
  writeFileSync(join(directory, "nested", "module.mjs"), "");
  writeFileSync(join(directory, "nested", "common.cjs"), "");
  writeFileSync(join(directory, "nested", "data.json"), "");
  writeFileSync(join(directory, "notes.txt"), "");

  const files = collectJavaScriptFiles({ directory }).map((file) =>
    relative(directory, file).replaceAll("\\", "/"),
  );

  assert.deepEqual(files, [
    "nested/common.cjs",
    "nested/module.mjs",
    "root.js",
  ]);
});
