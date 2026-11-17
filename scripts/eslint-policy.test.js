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
