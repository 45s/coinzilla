import { ESLint } from "eslint";
import { relative } from "node:path";
import process from "node:process";

async function main() {
  const eslint = new ESLint({ fix: true });
  const results = await eslint.lintFiles(["."]);
  await ESLint.outputFixes(results);

  console.log("BROKERS_ESLINT_FIX_OUTPUT_START");
  for (const result of results) {
    if (result.output === undefined) {
      continue;
    }

    console.log(
      JSON.stringify({
        path: relative(process.cwd(), result.filePath),
        content: Buffer.from(result.output).toString("base64"),
      }),
    );
  }
  console.log("BROKERS_ESLINT_FIX_OUTPUT_END");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
