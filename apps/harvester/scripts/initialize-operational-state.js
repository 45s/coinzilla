import path from "node:path"
import { fileURLToPath } from "node:url"
import { runInitializeOperationalState } from "../src/use-cases/initialize-operational-state-cli.js"

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  process.exitCode = await runInitializeOperationalState()
}
