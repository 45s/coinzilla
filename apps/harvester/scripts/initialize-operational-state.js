import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-operational-state-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-operational-state-directory.js"
import { acquireHarvesterProcessLocks } from "../src/infrastructure/process-lock/acquire-harvester-process-locks.js"
import { initializeHarvesterOperationalStateStore } from "../src/use-cases/initialize-operational-state-store.js"
import { runInitializeOperationalState } from "../src/use-cases/initialize-operational-state-cli.js"

const initialize = (options) => initializeHarvesterOperationalStateStore({
  ...options,
  processLockDirectory: path.join(os.homedir(), ".coinzilla", "harvester", "process-locks"),
  acquireProcessLock: acquireHarvesterProcessLocks,
  createStore: createFileOperationalStateStore,
})

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  process.exitCode = await runInitializeOperationalState({
    resolveDirectory: resolveOperationalStateDirectory,
    initialize,
    logger: defaultLogger,
  })
}
