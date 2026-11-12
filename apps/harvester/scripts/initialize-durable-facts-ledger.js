import { defaultLogger } from "@coinzilla/utils"
import { initializeHarvesterDurableFactsLedger } from "../src/use-cases/initialize-durable-facts-ledger.js"

const result = await initializeHarvesterDurableFactsLedger({
  confirmed: process.argv.includes("--confirm-initialize"),
})

if (result.ok) {
  defaultLogger.system?.("Harvester recovery-facts genesis initialized at " + result.data.directory + " (sequence " + result.data.sequence + ").")
} else {
  defaultLogger.error?.({
    message: "Harvester recovery-facts genesis was not initialized.",
    errors: result.errors,
  })
  process.exitCode = 1
}
