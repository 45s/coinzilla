import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import process from "node:process";

async function main() {
  const discovery = new ESLint();
  const discoveredFiles = await discovery.lintFiles(["."]);
  const originalContents = new Map(
    await Promise.all(
      discoveredFiles.map(async ({ filePath }) => [
        filePath,
        await readFile(filePath, "utf8"),
      ]),
    ),
  );

  const fixer = new ESLint({ fix: true });
  const results = await fixer.lintFiles(["."]);
  await ESLint.outputFixes(results);

  process.stdout.write("BROKERS_ESLINT_FIX_OUTPUT_START\n");
  for (const { filePath } of results) {
    const updatedContent = await readFile(filePath, "utf8");
    if (updatedContent === originalContents.get(filePath)) {
      continue;
    }

    process.stdout.write(
      `${JSON.stringify({
        path: relative(process.cwd(), filePath),
        content: Buffer.from(updatedContent).toString("base64"),
      })}\n`,
    );
  }
  process.stdout.write("BROKERS_ESLINT_FIX_OUTPUT_END\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
