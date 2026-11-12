import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The legacy direct initializer is deliberately disabled. It bypassed the
 * broker-wide/Journal process lock used by the supported package command.
 * Keep this guard so old operator instructions fail closed instead of
 * silently creating a second initialization path.
 */
export async function runInitializeDurableFacts({
  stdout = (message) => process.stdout.write(message + "\n"),
  stderr = (message) => process.stderr.write(message + "\n"),
} = {}) {
  void stdout
  stderr("Legacy durable-facts initialization is disabled because it bypasses the required process lock.")
  stderr("Use: pnpm --filter @coinzilla/harvester durable-facts:init -- --confirm-initialize")
  return 1
}

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  process.exitCode = await runInitializeDurableFacts()
}
