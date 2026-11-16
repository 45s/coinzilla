import { ESLint } from "eslint";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function summarizeResults(results) {
  let errorCount = 0;
  let warningCount = 0;
  const ruleCounts = new Map();

  for (const result of results) {
    errorCount += result.errorCount;
    warningCount += result.warningCount;

    for (const message of result.messages) {
      if (message.ruleId) {
        const currentCount = ruleCounts.get(message.ruleId) ?? 0;
        ruleCounts.set(message.ruleId, currentCount + 1);
      }
    }
  }

  const filesWithFindings = results.filter(
    (result) => result.errorCount > 0 || result.warningCount > 0,
  ).length;
  const topRules = [...ruleCounts.entries()]
    .map(([ruleId, count]) => ({
      ruleId,
      count,
    }))
    .sort((...entries) => {
      const [left, right] = entries;
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.ruleId.localeCompare(right.ruleId);
    })
    .slice(0, 10);

  return {
    fileCount: results.length,
    filesWithFindings,
    errorCount,
    warningCount,
    topRules,
  };
}

async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["."]);
  const summary = summarizeResults(results);

  process.stdout.write(
    `ESLint inventory: ${summary.filesWithFindings}/${summary.fileCount} files with findings; ${summary.errorCount} errors; ${summary.warningCount} warnings.\n`,
  );

  if (summary.topRules.length > 0) {
    process.stdout.write("Most frequent rules:\n");
    for (const rule of summary.topRules) {
      process.stdout.write(`- ${rule.ruleId}: ${rule.count}\n`);
    }
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { summarizeResults };
