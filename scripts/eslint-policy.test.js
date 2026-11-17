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

test("direct console usage is an error while explicit CLI output remains allowed", async () => {
  const eslint = new ESLint();
  const [directConsole] = await eslint.lintText(
    'console.log("diagnostic");\n',
    { filePath: "scripts/eslint-policy-fixture.js" },
  );
  const [cliOutput] = await eslint.lintText(
    'process.stdout.write("diagnostic");\n',
    { filePath: "scripts/eslint-policy-fixture.js" },
  );

  assert.equal(
    directConsole.messages.find((message) => message.ruleId === "no-console")?.severity,
    2,
    "Direct console usage must be rejected as an error.",
  );
  assert.equal(
    cliOutput.messages.filter((message) => message.ruleId === "no-console").length,
    0,
    "Explicit process stream output remains available for intentional CLI diagnostics.",
  );
});

test("implicit coercion is an error while explicit conversions remain available", async () => {
  const eslint = new ESLint();
  const [implicitCoercion] = await eslint.lintText(
    'const value = "1";\nconst numeric = +value;\nconst enabled = !!value;\n',
    { filePath: "apps/harvester/src/domain/implicit-coercion-fixture.js" },
  );
  const [explicitConversion] = await eslint.lintText(
    'const value = "1";\nconst numeric = Number(value);\nconst enabled = Boolean(value);\n',
    { filePath: "apps/harvester/src/domain/explicit-conversion-fixture.js" },
  );

  assert.ok(
    implicitCoercion.messages.some((message) => (
      message.ruleId === "no-implicit-coercion" && message.severity === 2
    )),
    "Implicit unary numeric and boolean coercions must be rejected as errors.",
  );
  assert.equal(
    explicitConversion.messages.filter((message) => message.ruleId === "no-implicit-coercion").length,
    0,
    "Explicit conversion functions remain available at intentional boundaries.",
  );
});

test("require-atomic-updates remains deferred until concurrency findings are classified", async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile(
    "apps/harvester/src/use-cases/create-portfolio-workflow.js",
  );
  const rule = config.rules["require-atomic-updates"];
  const severity = Array.isArray(rule) ? rule[0] : rule ?? 0;

  assert.equal(
    severity,
    0,
    "Do not enable require-atomic-updates until its 47 workspace findings receive targeted concurrency review.",
  );
});



function createFunctionQualityAuditEslint() {
  return new ESLint({
    overrideConfig: [
      {
        rules: {
          complexity: ["error", { max: 15 }],
          "max-lines-per-function": [
            "error",
            {
              max: 50,
              skipBlankLines: true,
              skipComments: true,
            },
          ],
          "max-statements": ["error", 15],
          "max-depth": ["error", 3],
          "default-param-last": "error",
        },
      },
      {
        files: ["apps/harvester/src/infrastructure/telegram/telegram-operator-adapter.js"],
        rules: {
          "max-lines-per-function": [
            "error",
            {
              max: 520,
              skipBlankLines: true,
              skipComments: true,
            },
          ],
        },
      },
    ],
  });
}

function collectFunctionQualityFindings({ results }) {
  const metrics = {
    complexity: [],
    maxLines: [],
    maxStatements: [],
    maxDepth: [],
    defaultParamLast: [],
  };
  const measurements = [
    {
      ruleId: "complexity",
      key: "complexity",
      pattern: /complexity of (\d+)/i,
    },
    {
      ruleId: "max-lines-per-function",
      key: "maxLines",
      pattern: /too many lines \((\d+)\)/i,
    },
    {
      ruleId: "max-statements",
      key: "maxStatements",
      pattern: /too many statements \((\d+)\)/i,
    },
    {
      ruleId: "max-depth",
      key: "maxDepth",
      pattern: /nested too deeply \((\d+)\)/i,
    },
    {
      ruleId: "default-param-last",
      key: "defaultParamLast",
      pattern: null,
    },
  ];

  for (const result of results) {
    for (const message of result.messages) {
      const measurement = measurements.find((candidate) => (
        candidate.ruleId === message.ruleId
      ));

      if (!measurement) {
        continue;
      }

      const measuredValue = measurement.pattern
        ? Number(message.message.match(measurement.pattern)?.[1])
        : null;

      assert.ok(
        !measurement.pattern || Number.isFinite(measuredValue),
        `The ${message.ruleId} audit must extract the measured value from this ESLint diagnostic: ${message.message}`,
      );
      metrics[measurement.key].push({
        filePath: result.filePath,
        line: message.line,
        value: measuredValue,
        message: message.message,
      });
    }
  }

  return metrics;
}

function compareFindingsByValue(...findings) {
  const [left, right] = findings;
  return right.value - left.value;
}

function countFindingsAboveThreshold({ findings, threshold }) {
  return findings.filter((finding) => finding.value > threshold);
}

function summarizeThresholdImpact({ findings, threshold }) {
  const affected = countFindingsAboveThreshold({
    findings,
    threshold,
  });
  return {
    functions: affected.length,
    files: new Set(affected.map((finding) => finding.filePath)).size,
    largest: affected
      .toSorted(compareFindingsByValue)
      .slice(0, 5)
      .map(({ filePath, line, value }) => ({
        file: filePath.replace(`${repositoryRoot}/`, ""),
        line,
        value,
      })),
  };
}

function listThresholdOffenders({ findings, threshold }) {
  return countFindingsAboveThreshold({
    findings,
    threshold,
  })
    .toSorted(compareFindingsByValue)
    .map((finding) => ({
      file: finding.filePath.replace(`${repositoryRoot}/`, ""),
      line: finding.line,
      value: finding.value,
      message: finding.message,
    }));
}

function createFunctionQualityAuditReport({ metrics }) {
  return {
    complexity: {
      15: summarizeThresholdImpact({
        findings: metrics.complexity,
        threshold: 15,
      }),
    },
    maxLines: {
      60: summarizeThresholdImpact({
        findings: metrics.maxLines,
        threshold: 60,
      }),
      50: summarizeThresholdImpact({
        findings: metrics.maxLines,
        threshold: 50,
      }),
    },
    maxStatements: {
      30: summarizeThresholdImpact({
        findings: metrics.maxStatements,
        threshold: 30,
      }),
      25: summarizeThresholdImpact({
        findings: metrics.maxStatements,
        threshold: 25,
      }),
      20: summarizeThresholdImpact({
        findings: metrics.maxStatements,
        threshold: 20,
      }),
      15: summarizeThresholdImpact({
        findings: metrics.maxStatements,
        threshold: 15,
      }),
    },
    maxDepth: {
      3: summarizeThresholdImpact({
        findings: metrics.maxDepth,
        threshold: 3,
      }),
      4: summarizeThresholdImpact({
        findings: metrics.maxDepth,
        threshold: 4,
      }),
    },
    maxDepthOffendersAt3: listThresholdOffenders({
      findings: metrics.maxDepth,
      threshold: 3,
    }),
    maxStatementsOffendersAt30: listThresholdOffenders({
      findings: metrics.maxStatements,
      threshold: 30,
    }),
    defaultParamLast: {
      violations: metrics.defaultParamLast.length,
      files: new Set(metrics.defaultParamLast.map((finding) => finding.filePath)).size,
      examples: metrics.defaultParamLast.slice(0, 10).map((finding) => ({
        file: finding.filePath.replace(`${repositoryRoot}/`, ""),
        line: finding.line,
        message: finding.message,
      })),
    },
  };
}

async function auditFunctionQualityThresholds() {
  const eslint = createFunctionQualityAuditEslint();
  const results = await eslint.lintFiles(["."]);
  const metrics = collectFunctionQualityFindings({ results });

  return {
    inspectedFiles: results.length,
    report: createFunctionQualityAuditReport({ metrics }),
  };
}

test("audits candidate function-quality thresholds across the complete workspace", async () => {
  const audit = await auditFunctionQualityThresholds();

  process.stdout.write(
    `\\nESLint function-quality candidate audit:\\n${JSON.stringify(audit, null, 2)}\\n`,
  );
  assert.ok(
    audit.inspectedFiles > 0,
    "The function-quality audit must inspect the complete ESLint workspace.",
  );
});
