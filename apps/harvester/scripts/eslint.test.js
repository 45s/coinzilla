import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT_DIRECTORY = "apps/harvester/scripts";

test("every tracked Harvester script JavaScript file is linted without errors or warnings", async () => {
  const trackedFiles = execFileSync(
    "git",
    ["ls-files", "-z", "--", SCRIPT_DIRECTORY],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((filePath) => /\.(?:js|mjs|cjs)$/.test(filePath))
    .sort();

  assert.ok(
    trackedFiles.length > 0,
    "The Harvester scripts ESLint regression must discover tracked JavaScript files before checking the directory.",
  );

  const eslint = new ESLint({ cwd: REPOSITORY_ROOT });
  const ignoredFiles = await Promise.all(
    trackedFiles.map(async (filePath) => ({
      filePath,
      isIgnored: await eslint.isPathIgnored(filePath),
    })),
  );

  assert.deepEqual(
    ignoredFiles.filter(({ isIgnored }) => isIgnored),
    [],
    "Every tracked JavaScript file under apps/harvester/scripts must remain in the effective ESLint scope.",
  );

  const results = await eslint.lintFiles(trackedFiles);
  const scannedFiles = results
    .map((result) => path.relative(REPOSITORY_ROOT, result.filePath).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(
    scannedFiles,
    trackedFiles,
    "The directory-wide ESLint regression must scan every tracked Harvester script file exactly once.",
  );

  const findings = results.flatMap((result) => result.messages.map((message) => ({
    filePath: path.relative(REPOSITORY_ROOT, result.filePath).replaceAll("\\", "/"),
    line: message.line,
    column: message.column,
    severity: message.severity,
    ruleId: message.ruleId,
    message: message.message,
  })));

  assert.deepEqual(
    findings,
    [],
    `Every tracked Harvester script must have zero ESLint errors and warnings. Findings: ${JSON.stringify(findings, null, 2)}`,
  );
});
