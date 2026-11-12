import { defaultLogger } from "@coinzilla/utils"
import { initializeHarvesterDurableFactsLedger } from "../src/use-cases/initialize-durable-facts-ledger.js"

const result = await initializeHarvesterDurableFactsLedger({
  confirmed: process.argv.includes("--confirm-initialize"),
})

if (result.ok) {
  defaultLogger.system?.({
    message: "Harvester recovery-facts genesis initialized.",
    directory: result.data.directory,
    sequence: result.data.sequence,
    digest: result.data.digest,
  })
} else {
  defaultLogger.error?.({
    message: "Harvester recovery-facts genesis was not initialized.",
    errors: result.errors,
  })
  process.exitCode = 1
}
