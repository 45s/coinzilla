import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const javascriptExtensions = /\.(?:js|mjs|cjs)$/i;
const strictRules = {
  complexity: ["error", { max: 15 }],
  "max-params": ["error", 1],
  "max-lines-per-function": [
    "error",
    {
      max: 60,
      skipBlankLines: true,
      skipComments: true,
    },
  ],
  "max-statements": ["error", 30],
  "max-depth": ["error", 3],
  "max-nested-callbacks": ["error", 2],
};

function runGit({ cwd, args }) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Parse Git's NUL-delimited name-status output and keep JavaScript destinations.
 *
 * @param {{ output: string }} input
 * @returns {string[]}
 */
export function parseChangedPaths({ output }) {
  const entries = output.split("\0");
  const paths = new Set();

  for (let index = 0; index < entries.length;) {
    const status = entries[index];
    index += 1;

    if (!status) {
      continue;
    }

    const isRenameOrCopy = status.startsWith("R") || status.startsWith("C");
    if (isRenameOrCopy) {
      if (!entries[index] || !entries[index + 1]) {
        throw new Error(`Git returned an incomplete ${status} file-status record.`);
      }
      index += 1;
    }

    const changedPath = entries[index];
    index += 1;

    if (!changedPath && status !== "D") {
      throw new Error(`Git returned an incomplete ${status} file-status record.`);
    }

    if (
      changedPath
      && /^(?:A|C|M|R|T)/.test(status)
      && javascriptExtensions.test(changedPath)
    ) {
      paths.add(changedPath);
    }
  }

  return [...paths].toSorted();
}

/**
 * Resolve the common ancestor and return changed JavaScript destination paths.
 *
 * @param {{ cwd: string, baseRef: string, headRef: string }} input
 * @returns {Promise<string[]>}
 */
export async function getChangedFiles({ cwd, baseRef, headRef }) {
  if (!baseRef || !headRef) {
    throw new Error("Both base and head Git refs are required for strict changed-file lint.");
  }

  let mergeBase;
  try {
    mergeBase = runGit({
      cwd,
      args: ["merge-base", baseRef, headRef],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(
      `Unable to determine merge base between "${baseRef}" and "${headRef}". Fetch the target branch and complete Git history. Git reported: ${detail}`,
      { cause: error },
    );
  }

  if (!mergeBase) {
    throw new Error(
      `Git returned an empty merge base for "${baseRef}" and "${headRef}". Strict lint cannot continue.`,
    );
  }

  let changedOutput;
  let workingTreeOutput;
  let untrackedOutput;
  try {
    const diffArguments = [
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "--find-copies",
      "--find-copies-harder",
      "--diff-filter=ACMRT",
    ];
    changedOutput = runGit({
      cwd,
      args: [...diffArguments, mergeBase, headRef],
    });
    workingTreeOutput = runGit({
      cwd,
      args: [...diffArguments, headRef],
    });
    untrackedOutput = runGit({
      cwd,
      args: ["ls-files", "--others", "--exclude-standard", "-z"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(
      `Unable to compare changed files from merge base "${mergeBase}" to "${headRef}". Git reported: ${detail}`,
      { cause: error },
    );
  }

  const committedAndModified = parseChangedPaths({
    output: changedOutput + workingTreeOutput,
  });
  const untracked = untrackedOutput
    .split("\0")
    .filter((path) => path && javascriptExtensions.test(path));

  return [...new Set([...committedAndModified, ...untracked])].toSorted();
}

/**
 * Extend the canonical root flat configuration with only approved strict thresholds.
 *
 * @param {{ cwd?: string }} input
 * @returns {ESLint}
 */
export function createStrictESLint({ cwd = repositoryRoot } = {}) {
  return new ESLint({
    cwd,
    overrideConfig: [
      {
        rules: strictRules,
      },
    ],
  });
}

/**
 * Lint each selected file in its entirety; ignored or unprocessable files remain failures.
 *
 * @param {{ files: string[], cwd?: string }} input
 * @returns {Promise<{ errorCount: number, warningCount: number, results: object[] }>}
 */
export async function lintChangedFiles({ files, cwd = repositoryRoot }) {
  if (files.length === 0) {
    return {
      errorCount: 0,
      warningCount: 0,
      results: [],
    };
  }

  const eslint = createStrictESLint({ cwd });
  const results = await eslint.lintFiles(files.map((file) => resolve(cwd, file)));
  const errorCount = results.reduce((total, result) => total + result.errorCount, 0);
  const warningCount = results.reduce((total, result) => total + result.warningCount, 0);

  return {
    errorCount,
    warningCount,
    results,
  };
}

async function run() {
  const cwd = process.cwd();
  const baseRef = process.env.LINT_CHANGED_BASE_REF || "origin/develop";
  const headRef = process.env.LINT_CHANGED_HEAD_REF || "HEAD";
  const files = await getChangedFiles({
    cwd,
    baseRef,
    headRef,
  });

  if (files.length === 0) {
    process.stdout.write(
      `No changed JavaScript files to lint (merge base of ${baseRef} and ${headRef}).\n`,
    );
    return;
  }

  process.stdout.write(
    `Strictly linting ${files.length} changed JavaScript file(s) against the merge base of ${baseRef} and ${headRef}.\n`,
  );

  const { errorCount, warningCount, results } = await lintChangedFiles({
    cwd,
    files,
  });
  const eslint = createStrictESLint({ cwd });
  const formatter = await eslint.loadFormatter("stylish");
  const formatted = formatter.format(results);

  if (formatted) {
    process.stdout.write(formatted);
  }

  if (errorCount > 0 || warningCount > 0) {
    process.stderr.write(
      `Strict changed-file ESLint failed: ${errorCount} error(s), ${warningCount} warning(s).\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Strict changed-file ESLint passed for ${files.length} file(s).\n`,
  );
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  run().catch((error) => {
    process.stderr.write(`Strict changed-file ESLint could not run: ${error.message}\n`);
    process.exitCode = 1;
  });
}
