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

function parseChangedFileNames(output) {
  const fields = output.split("\0");
  const changes = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = fields[index];
      const currentPath = fields[index + 1];
      index += 2;
      changes.push({ path: currentPath, basePath: previousPath });
    } else {
      const path = fields[index];
      index += 1;
      if (status[0] !== "D") {
        changes.push({ path, basePath: status[0] === "A" ? null : path });
      }
    }
  }

  return changes.filter((change) => change.path);
}

function getChangedFileChanges({ baseSha }) {
  const result = spawnSync(
    "git",
    ["diff", "--name-status", "--find-renames", "-z", baseSha, "HEAD"],
    { encoding: "utf8" },
  );

  if (result.error) {
    throw new Error(\`Could not inspect changed files: \${result.error.message}\`);
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr || \`Git diff exited with status \${result.status}.\`,
    );
  }

  return parseChangedFileNames(result.stdout);
}

function getChangedFiles({ baseSha }) {
  return getChangedFileChanges({ baseSha }).map((change) => change.path);
}

function findingKey(message) {
  return JSON.stringify([
    message.ruleId ?? "fatal",
    message.messageId ?? null,
    message.message,
    message.nodeType ?? null,
    message.source?.trim() ?? "",
  ]);
}

function countFindings(messages) {
  const counts = new Map();
  for (const message of messages) {
    const key = findingKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function lintChangedFiles({ baseSha }) {
  const changes = getChangedFileChanges({ baseSha }).filter((change) => (
    selectChangedJavaScriptFiles([change.path]).length > 0
  ));
  if (changes.length === 0) {
    process.stdout.write("No changed JavaScript files require ESLint.\n");
    return 0;
  }

  const eslint = new ESLint();
  const introduced = [];
  for (const change of changes) {
    const currentResults = await eslint.lintFiles([change.path]);
    const currentMessages = currentResults.flatMap((result) => result.messages);
    const baseResult = change.basePath
      ? spawnSync("git", ["show", \`\${baseSha}:\${change.basePath}\`], { encoding: "utf8" })
      : null;
    if (baseResult?.error) {
      throw new Error(\`Could not read baseline for \${change.path}: \${baseResult.error.message}\`);
    }
    const baseMessages = baseResult?.status === 0
      ? (await eslint.lintText(baseResult.stdout, { filePath: change.path }))[0].messages
      : [];
    const baseline = countFindings(baseMessages);

    for (const message of currentMessages) {
      const key = findingKey(message);
      const remaining = baseline.get(key) ?? 0;
      if (remaining > 0) {
        baseline.set(key, remaining - 1);
      } else {
        introduced.push({ filePath: change.path, message });
      }
    }
  }

  if (introduced.length > 0) {
    for (const { filePath, message } of introduced) {
      const severity = message.severity === 2 ? "error" : "warning";
      process.stderr.write(
        \`\${filePath}:\${message.line ?? 0}:\${message.column ?? 0} \${severity} \${message.message} \${message.ruleId ?? "fatal"}\n\`,
      );
    }
    process.stderr.write(
      \`ESLint found \${introduced.length} new violation(s); unchanged baseline findings are tolerated.\n\`,
    );
    return 1;
  }

  process.stdout.write(
    "Changed JavaScript files introduce no ESLint violations; unchanged baseline findings are tolerated.\n",
  );
  return 0;
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const baseSha = process.env.BASE_SHA ?? process.argv[2];

  if (!baseSha) {
    process.stderr.write("Set BASE_SHA to the exact pull-request base commit SHA.\n");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = await lintChangedFiles({ baseSha });
    } catch (error) {
      process.stderr.write(\`\${error.message}\n\`);
      process.exitCode = 1;
    }
  }
}

export {
  countFindings,
  findingKey,
  getChangedFileChanges,
  getChangedFiles,
  lintChangedFiles,
  parseChangedFileNames,
  selectChangedJavaScriptFiles,
};
