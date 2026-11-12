import assert from "node:assert/strict";
import test from "node:test";

import { summarizeResults } from "./report-eslint-baseline.js";

test("summarizeResults counts file findings and rule occurrences", () => {
  const summary = summarizeResults([
    {
      errorCount: 2,
      warningCount: 1,
      messages: [
        { ruleId: "no-undef" },
        { ruleId: "no-undef" },
        { ruleId: "eqeqeq" },
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
        { ruleId: "no-undef", count: 2 },
        { ruleId: "curly", count: 1 },
        { ruleId: "eqeqeq", count: 1 },
      ],
    },
    "The ESLint inventory must report file totals, severity totals and frequent rules.",
  );
});
