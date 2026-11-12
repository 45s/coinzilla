import { extname } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const javascriptExtensions = new Set([".js", ".mjs", ".cjs"]);
const ignoredPathSegments = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "generated",
  "logs",
  "node_modules",
  "vendor",
]);

function selectChangedJavaScriptFiles(paths) {
  return [...new Set(paths)]
    .filter((path) => {
      const segments = path.split("/");
      return (
        javascriptExtensions.has(extname(path)) &&
        !segments.some((segment) => ignoredPathSegments.has(segment))
      );
    })
    .sort();
}

function getChangedFiles({ baseSha }) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${baseSha}...HEAD`],
    { encoding: "utf8" },
  );

  if (result.error) {
    throw new Error(`Could not inspect changed files: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr || `Git diff exited with status ${result.status}.`,
    );
  }

  return result.stdout.split("\0").filter(Boolean);
}

function lintChangedFiles({ baseSha }) {
  const changedFiles = selectChangedJavaScriptFiles(getChangedFiles({ baseSha }));

  if (changedFiles.length === 0) {
    console.log("No changed JavaScript files require ESLint.");
    return 0;
  }

  const result = spawnSync(
    process.execPath,
    [
      "node_modules/eslint/bin/eslint.js",
      "--max-warnings",
      "0",
      "--suppressions-location",
      "eslint-empty-suppressions.json",
      ...changedFiles,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error(`Could not run ESLint: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const isMainModule =
  process.argv[1] &&
  new URL(import.meta.url).pathname === process.argv[1];

if (isMainModule) {
  const baseSha = process.env.BASE_SHA ?? process.argv[2];

  if (!baseSha) {
    console.error("Set BASE_SHA to the exact pull-request base commit SHA.");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = lintChangedFiles({ baseSha });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

export { getChangedFiles, lintChangedFiles, selectChangedJavaScriptFiles };
