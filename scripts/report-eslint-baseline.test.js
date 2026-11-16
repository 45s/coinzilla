import assert from "node:assert/strict";
import test from "node:test";

import { summarizeResults } from "./report-eslint-baseline.js";

test("summarizeResults counts file findings and rule occurrences", () => {
  const summary = summarizeResults([
    {
      errorCount: 2,
      warningCount: 1,
      messages: [
        {
          ruleId: "no-undef",
        },
        {
          ruleId: "no-undef",
        },
        {
          ruleId: "eqeqeq",
        },
      ],
    },
    {
      errorCount: 0,
      warningCount: 1,
      messages: [{ ruleId: "curly" }],
    },
    {
      errorCount: 0,
      warningCount: 0,
      messages: [],
    },
  ]);

  assert.deepEqual(
    summary,
    {
      fileCount: 3,
      filesWithFindings: 2,
      errorCount: 2,
      warningCount: 2,
      topRules: [
        {
          ruleId: "no-undef",
          count: 2,
        },
        {
          ruleId: "curly",
          count: 1,
        },
        {
          ruleId: "eqeqeq",
          count: 1,
        },
      ],
    },
    "The ESLint inventory must report file totals, severity totals and frequent rules.",
  );
});


test("every tracked root scripts JavaScript file is linted without findings", async () => {
  const { execFileSync } = await import("node:child_process");
  const { relative } = await import("node:path");
  const { ESLint } = await import("eslint");
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["scripts"]);
  const trackedFiles = execFileSync("git", ["ls-files", "-z", "scripts"], {
    encoding: "utf8",
  }).split("\0").filter((path) => /\.(?:js|mjs|cjs)$/.test(path));
  const lintedFiles = new Set();
  const findingsByFile = {};
  const findingsByRule = {};
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    const path = relative(process.cwd(), result.filePath).replaceAll("\\", "/");
    lintedFiles.add(path);
    errorCount += result.errorCount;
    warningCount += result.warningCount;
    if (result.messages.length === 0) {
      continue;
    }

    findingsByFile[path] = result.messages.map((message) => ({
      ruleId: message.ruleId,
      severity: message.severity === 2 ? "error" : "warning",
      line: message.line,
      column: message.column,
      message: message.message,
    }));
    for (const finding of result.messages) {
      if (!finding.ruleId) {
        continue;
      }
      findingsByRule[finding.ruleId] = (findingsByRule[finding.ruleId] ?? 0) + 1;
    }
  }

  const missingFiles = trackedFiles.filter((path) => !lintedFiles.has(path));
  assert.deepEqual(
    missingFiles,
    [],
    "Every tracked root scripts JavaScript file must be included in the ESLint results.",
  );
  assert.equal(
    errorCount + warningCount,
    0,
    JSON.stringify({
      errorCount,
      warningCount,
      findingsByRule,
      findingsByFile,
    }, null, 2),
  );
});
