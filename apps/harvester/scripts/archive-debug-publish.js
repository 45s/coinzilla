import path from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import { runHarvesterDebugArchivePublication } from "./archive-debug-publication.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function createCliIdentity({ env = process.env } = {}) {
  const metadata = captureBuildMetadata({
    application: "harvester-debug-archive-publish",
    version: packageMetadata.version,
    cwd: PACKAGE_DIRECTORY,
    env,
  })
  const { source } = metadata
  return [
    `${metadata.application} ${metadata.version}`,
    `commit ${source.commit ?? "unknown"}`,
    `worktree ${source.workingTree}`,
    `node ${process.version}`,
  ].join(" | ")
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${createCliIdentity()}\n`)
    return
  }
  process.stdout.write(`${createCliIdentity()}\n`)
  const result = await runHarvesterDebugArchivePublication({
    args,
    packageDirectory: PACKAGE_DIRECTORY,
  })
  process.stdout.write(`${[
    "Harvester debug archive published and remotely verified.",
    `Archive: archives/${result.archiveName}`,
    `Remote commit: ${result.remoteCommit}`,
    `Files verified: ${result.fileCount}`,
    `Already published: ${result.alreadyPublished}`,
    `Local source: ${result.directory}`,
  ].join("\n")}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester debug archive publication failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
