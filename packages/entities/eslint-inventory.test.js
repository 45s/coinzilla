import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

test("exports ESLint autofixes for the Entities package", async () => {
  const eslint = new ESLint({
    cwd: packageRoot,
    fix: true,
  });
  const results = await eslint.lintFiles(["**/*.{js,mjs,cjs}"]);
  const changedFiles = [];

  for (const result of results) {
    if (typeof result.output !== "string") {
      continue;
    }

    changedFiles.push({
      path: relative(packageRoot, result.filePath),
      content: result.output,
    });
  }

  await ESLint.outputFixes(results);
  process.stdout.write("ENTITIES_ESLINT_AUTOFIX_FILES\n");

  for (const file of changedFiles) {
    process.stdout.write(
      `${file.path}\n${Buffer.from(file.content).toString("base64")}\n`,
    );
  }

  assert.ok(changedFiles.length > 0, "Expected ESLint to produce autofixes.");
});
