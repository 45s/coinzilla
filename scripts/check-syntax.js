import { readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceDirectories = ["apps", "packages"];
const javascriptExtensions = new Set([".js", ".mjs", ".cjs"]);

function collectJavaScriptFiles({ directory }) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectJavaScriptFiles({ directory: path });
      }

      if (entry.isFile() && javascriptExtensions.has(extname(entry.name))) {
        return [path];
      }

      return [];
    })
    .sort();
}

function checkJavaScriptSyntax({ files }) {
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      stdio: "inherit",
    });

    if (result.error) {
      console.error(`Could not check ${file}: ${result.error.message}`);
      return false;
    }

    if (result.status !== 0) {
      return false;
    }
  }

  console.log(`Checked ${files.length} JavaScript files.`);
  return true;
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const root = process.cwd();
  const files = sourceDirectories.flatMap((directory) =>
    collectJavaScriptFiles({ directory: join(root, directory) }),
  );

  if (!checkJavaScriptSyntax({ files })) {
    process.exitCode = 1;
  }
}

export { collectJavaScriptFiles, checkJavaScriptSyntax };
