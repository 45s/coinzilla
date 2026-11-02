import { toResult } from "@coinzilla/utils"
import { readJournalRecords } from "./read-journal-records.js"

/**
 * Validate the complete journal before invoking the consumer, then replay in order.
 * Handler effects are at-least-once across process crashes; consumers must be idempotent.
 * @param {{ directory: string, handler: (input: { record: object }) => unknown, maxRecords?: number, maxBytes?: number, maxRecordBytes?: number }} input
 */
export async function replayJournalRecords({ handler, ...options } = {}) {
  if (typeof handler !== "function") {
    return toResult({ error: new TypeError("A replay handler is required") })
  }

  const readResult = await readJournalRecords(options)
  if (!readResult.ok) return readResult

  let replayed = 0
  for (const record of readResult.records) {
    try {
      const result = await handler({ record })
      if (result && result.ok === false) {
        return toResult({
          errors: result.errors ?? [new Error(`Replay handler rejected record ${record.id}`)],
          replayed,
          failedRecordId: record.id,
        })
      }
      replayed += 1
    } catch (error) {
      return toResult({ error, replayed, failedRecordId: record.id })
    }
  }

  return toResult({ replayed, count: readResult.count })
}
