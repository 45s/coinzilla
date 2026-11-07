import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const files = packageJson.config?.targetedTestFiles;

if (!Array.isArray(files) || files.length === 0) {
  console.error("No targeted test files configured in package.json (config.targetedTestFiles).");
  process.exit(1);
}

let failed = false;
const seen = new Set();

for (const file of files) {
  if (typeof file !== "string" || file.trim() === "" || isAbsolute(file)) {
    console.error(`Invalid targeted test path: ${String(file)}`);
    failed = true;
    continue;
  }

  const absolutePath = resolve(packageDirectory, file);
  const relativePath = relative(packageDirectory, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath) || !file.endsWith(".test.js")) {
    console.error(`Targeted test path must be a package-local *.test.js file: ${file}`);
    failed = true;
    continue;
  }
  if (seen.has(file)) {
    console.error(`Duplicate targeted test path: ${file}`);
    failed = true;
    continue;
  }
  seen.add(file);

  if (!existsSync(absolutePath)) {
    console.error(`Targeted test file does not exist: ${file}`);
    failed = true;
    continue;
  }

  console.log(`\\n===== Targeted test: ${file} =====`);
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=spec", file],
    { cwd: packageDirectory, stdio: "inherit" }
  );
  if (result.error) {
    console.error(result.error);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
