import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = resolve(packageDirectory, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const configuredFiles = packageJson.config?.targetedTestFiles;
const perFileTimeoutMs = 5 * 60 * 1000;
const startedAt = new Date();
const results = [];
const seen = new Set();
let configurationErrors = 0;

// Respect NO_COLOR and explicit FORCE_COLOR=0. GitHub Actions logs and modern
// Windows terminals support ANSI escape sequences.
const colorEnabled =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0" &&
  (process.stdout.isTTY || process.stderr.isTTY || Boolean(process.env.CI));

const color = (code, value) =>
  colorEnabled ? "\u001B[" + code + "m" + value + "\u001B[0m" : value;

const green = (value) => color("32", value);
const red = (value) => color("31", value);
const yellow = (value) => color("33", value);
const cyan = (value) => color("36", value);
const gray = (value) => color("90", value);
const bold = (value) => color("1", value);

function logSection(title) {
  console.log("\n" + cyan(bold("━".repeat(88))));
  console.log(cyan(bold("  " + title)));
  console.log(cyan(bold("━".repeat(88))));
}

function statusLabel(status) {
  if (status === "PASS") return green("✔ PASS");
  if (status === "SKIP") return yellow("↷ SKIP");
  if (status === "TIMEOUT") return red("◷ TIMEOUT");
  if (status === "SPAWN ERROR") return red("✖ SPAWN ERROR");
  if (status === "TERMINATED") return red("✖ TERMINATED");
  return red("✖ " + status);
}

function formatDuration(milliseconds) {
  return (milliseconds / 1000).toFixed(2) + "s";
}

function reportConfigurationError(message, filePath = "") {
  configurationErrors += 1;
  console.error(red("✖ CONFIGURATION ERROR: ") + message);
  console.error(gray("  Package: " + packageJsonPath));
  if (filePath) console.error(gray("  Configured path: " + filePath));
  console.error("::error::TARGETED TEST CONFIGURATION: " + message);
}

logSection("HARVESTER TARGETED TEST RUN — ENVIRONMENT");
console.log("Started at:       " + startedAt.toISOString());
console.log("Package:          " + packageJson.name);
console.log("Package version:  " + packageJson.version);
console.log("Package root:     " + packageDirectory);
console.log("Working directory:" + process.cwd());
console.log("Node version:     " + process.version);
console.log("Node executable:  " + process.execPath);
console.log("Platform:         " + process.platform + " / " + process.arch);
console.log("Package manifest: " + packageJsonPath);
console.log("Per-file timeout: " + formatDuration(perFileTimeoutMs));

if (!Array.isArray(configuredFiles) || configuredFiles.length === 0) {
  reportConfigurationError(
    "No targeted test files configured. Add paths to config.targetedTestFiles in apps/harvester/package.json."
  );
  logSection("FINAL RESULT");
  console.error("RESULT: FAILED — no test files were configured.");
  process.exit(1);
}

console.log("Configured files: " + configuredFiles.length);

for (let index = 0; index < configuredFiles.length; index += 1) {
  const configuredPath = configuredFiles[index];
  const ordinal = String(index + 1).padStart(2, "0");

  logSection("CONFIGURATION CHECK " + ordinal + "/" + configuredFiles.length);

  if (
    typeof configuredPath !== "string" ||
    configuredPath.trim() === "" ||
    isAbsolute(configuredPath)
  ) {
    reportConfigurationError("Path must be a non-empty relative string.", String(configuredPath));
    results.push({ path: String(configuredPath), status: "INVALID PATH", durationMs: 0 });
    continue;
  }

  const absolutePath = resolve(packageDirectory, configuredPath);
  const packageRelativePath = relative(packageDirectory, absolutePath);

  console.log("Configured path:  " + configuredPath);
  console.log("Resolved path:    " + absolutePath);

  if (
    packageRelativePath.startsWith("..") ||
    isAbsolute(packageRelativePath) ||
    !configuredPath.endsWith(".test.js")
  ) {
    reportConfigurationError(
      "Path must remain inside the Harvester package and end with .test.js.",
      configuredPath
    );
    results.push({ path: configuredPath, absolutePath, status: "INVALID PATH", durationMs: 0 });
    continue;
  }

  if (seen.has(configuredPath)) {
    reportConfigurationError("Duplicate test path.", configuredPath);
    results.push({ path: configuredPath, absolutePath, status: "DUPLICATE", durationMs: 0 });
    continue;
  }
  seen.add(configuredPath);

  if (!existsSync(absolutePath)) {
    reportConfigurationError("Test file does not exist at the resolved path.", configuredPath);
    results.push({ path: configuredPath, absolutePath, status: "MISSING FILE", durationMs: 0 });
    continue;
  }

  const fileStats = statSync(absolutePath);
  if (!fileStats.isFile()) {
    reportConfigurationError("Resolved path exists but is not a regular file.", configuredPath);
    results.push({ path: configuredPath, absolutePath, status: "NOT A FILE", durationMs: 0 });
    continue;
  }

  console.log("File size:        " + fileStats.size + " bytes");
  console.log("Last modified:    " + fileStats.mtime.toISOString());
  console.log("Test command:     " + process.execPath + " --trace-uncaught --test --test-reporter=spec " + configuredPath);
  console.log("Timeout:          " + formatDuration(perFileTimeoutMs));
  console.log("Output:           stdout/stderr streamed directly below");
  console.log("BEGIN TEST OUTPUT");

  const testStarted = process.hrtime.bigint();
  const child = spawnSync(
    process.execPath,
    ["--trace-uncaught", "--test", "--test-reporter=spec", configuredPath],
    {
      cwd: packageDirectory,
      stdio: "inherit",
      timeout: perFileTimeoutMs,
      env: { ...process.env, FORCE_COLOR: colorEnabled ? "1" : "0" }
    }
  );
  const durationMs = Number(process.hrtime.bigint() - testStarted) / 1_000_000;
  let status = "PASS";
  let details = "";

  if (child.error) {
    status = child.error.code === "ETIMEDOUT" ? "TIMEOUT" : "SPAWN ERROR";
    details = child.error.stack || child.error.message;
  } else if (child.status !== 0) {
    status = child.signal ? "TERMINATED" : "FAIL";
    details = "Exit code: " + child.status + (child.signal ? "; signal: " + child.signal : "");
  }

  console.log(gray("END TEST OUTPUT"));
  console.log("File result:      " + statusLabel(status));
  console.log("Exit code:        " + (child.status === 0 ? green("0") : red(String(child.status))));
  console.log("Signal:           " + (child.signal ? red(child.signal) : gray("none")));
  console.log("Spawn error:      " + (child.error ? red(child.error.message) : gray("none")));
  console.log("Duration:         " + formatDuration(durationMs));
  console.log("Absolute path:    " + gray(absolutePath));

  if (details) {
    console.error(red(bold("DIAGNOSTIC DETAIL:")));
    console.error(red(details));
    console.error("::error file=" + configuredPath + "::Targeted test " + status + " — " + details.replace(/\r?\n/g, " "));
  }

  results.push({ path: configuredPath, absolutePath, status, durationMs, exitCode: child.status, signal: child.signal });
}

const finishedAt = new Date();
const totalDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.filter((result) => !["PASS"].includes(result.status)).length;

logSection("FINAL RESULT — PER-FILE SUMMARY");
console.log("Started:          " + startedAt.toISOString());
console.log("Finished:         " + finishedAt.toISOString());
console.log("Elapsed wall time:" + formatDuration(finishedAt.getTime() - startedAt.getTime()));
console.log("Total test time:  " + formatDuration(totalDurationMs));
console.log("Configured files: " + configuredFiles.length);
console.log("Passed files:     " + green(String(passed)));
console.log("Failed files:     " + (failed > 0 ? red(String(failed)) : green("0")));
console.log("Config errors:    " + (configurationErrors > 0 ? red(String(configurationErrors)) : green("0")));

for (const result of results) {
  console.log(
    statusLabel(result.status).padEnd(colorEnabled ? 22 : 14) +
    " " + formatDuration(result.durationMs).padStart(8) +
    "  " + result.path
  );
  if (result.absolutePath) console.log(gray("       FULL PATH: " + result.absolutePath));
  if (result.exitCode !== undefined) console.log(gray("       EXIT CODE: " + result.exitCode));
  if (result.signal) console.log(gray("       SIGNAL:    " + result.signal));
}

const overallFailed = configurationErrors > 0 || failed > 0;
console.log("\nOVERALL STATUS: " + (overallFailed ? red(bold("✖ FAILED")) : green(bold("✔ PASSED"))));

if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    "# Harvester targeted test results",
    "",
    "- **Overall:** " + (overallFailed ? "FAILED" : "PASSED"),
    "- **Started:** " + startedAt.toISOString(),
    "- **Finished:** " + finishedAt.toISOString(),
    "- **Configured files:** " + configuredFiles.length,
    "- **Passed:** " + passed,
    "- **Failed/configuration errors:** " + (failed + configurationErrors),
    "",
    "| Result | Duration | Configured path | Resolved path | Exit |",
    "|---|---:|---|---|---:|",
    ...results.map((result) =>
      "| " + result.status + " | " + formatDuration(result.durationMs) +
      " | \`" + result.path + "\` | \`" + (result.absolutePath || "—") +
      "\` | " + (result.exitCode ?? "—") + " |"
    ),
    ""
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

process.exit(overallFailed ? 1 : 0);
