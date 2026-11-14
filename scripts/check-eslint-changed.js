import { extname, resolve } from "node:path";
import { ESLint } from "eslint";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
    ["diff", "--name-only", "--diff-filter=ACMR", "-z", baseSha, "HEAD"],
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

function findingKey(message) {
  return [
    message.ruleId,
    message.messageId,
    message.message,
    message.source?.split("\n")[0]?.trim() ?? "",
  ].join("|");
}

function countFindings(messages) {
  const counts = new Map();
  for (const message of messages) {
    if (!message.ruleId) continue;
    const key = findingKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function lintChangedFiles({ baseSha }) {
  const changedFiles = selectChangedJavaScriptFiles(getChangedFiles({ baseSha }));
  if (changedFiles.length === 0) {
    console.log("No changed JavaScript files require ESLint.");
    return 0;
  }

  const eslint = new ESLint();
  const introduced = [];
  for (const filePath of changedFiles) {
    const currentResults = await eslint.lintFiles([filePath]);
    const currentMessages = currentResults.flatMap((result) => result.messages);
    const baseResult = spawnSync("git", ["show", `${baseSha}:${filePath}`], { encoding: "utf8" });
    const baseMessages = baseResult.status === 0
      ? (await eslint.lintText(baseResult.stdout, { filePath }))[0].messages
      : [];
    const baseline = countFindings(baseMessages);
    for (const message of currentMessages) {
      if (!message.ruleId) continue;
      const key = findingKey(message);
      const remaining = baseline.get(key) ?? 0;
      if (remaining > 0) {
        baseline.set(key, remaining - 1);
      } else {
        introduced.push({ filePath, message });
      }
    }
  }

  if (introduced.length > 0) {
    for (const { filePath, message } of introduced) {
      console.error(`${filePath}:${message.line ?? 0}:${message.column ?? 0} ${message.severity === 2 ? "error" : "warning"} ${message.message} ${message.ruleId}`);
    }
    console.error(`ESLint found ${introduced.length} new violation(s); pre-existing findings are baselined.`);
    return 1;
  }

  console.log("Changed JavaScript files introduce no ESLint violations; pre-existing findings are baselined.");
  return 0;
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const baseSha = process.env.BASE_SHA ?? process.argv[2];

  if (!baseSha) {
    console.error("Set BASE_SHA to the exact pull-request base commit SHA.");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = await lintChangedFiles({ baseSha });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

export { getChangedFiles, lintChangedFiles, selectChangedJavaScriptFiles };
