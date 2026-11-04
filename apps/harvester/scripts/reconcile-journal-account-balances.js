import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { Journal } from "@coinzilla/journal"
import { reconcileJournalAccountSnapshotRecords } from "./account-snapshot-journal-utils.js"

const directory = process.argv[2] ?? process.env.HARVESTER_JOURNAL_DIRECTORY ?? "logs"
const journal = new Journal({
  eventBus: new EventBus(),
  directory: path.resolve(directory),
  logger: { info() {}, error() {} },
})
const readResult = await journal.read()
if (!readResult.ok) {
  process.stderr.write((readResult.errors ?? []).map((error) => error.message).join("\n") + "\n")
  process.exitCode = 1
} else {
  const result = reconcileJournalAccountSnapshotRecords({ records: readResult.records })
  const output = result.ok
    ? result.data
    : { ...(result.data ?? {}), errors: (result.errors ?? []).map((error) => error.message) }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n")
  if (!result.ok) process.exitCode = 1
}
