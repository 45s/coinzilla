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
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((left, right) => {
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

  console.log(
    `ESLint inventory: ${summary.filesWithFindings}/${summary.fileCount} files with findings; ${summary.errorCount} errors; ${summary.warningCount} warnings.`,
  );

  if (summary.topRules.length > 0) {
    console.log("Most frequent rules:");
    for (const rule of summary.topRules) {
      console.log(`- ${rule.ruleId}: ${rule.count}`);
    }
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { summarizeResults };
