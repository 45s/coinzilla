import assert from "node:assert/strict"
import test from "node:test"
import {
  pollTelegramOperatorUpdates,
  processTelegramUpdate,
  waitForRetry,
} from "./telegram-operator-updates.js"

test("processes an update with a stable correlation and reports completion", async () => {
  const stages = []
  const result = await processTelegramUpdate({
    update: { update_id: 901, message: { text: "/status" } },
    respondToUpdate: async () => {},
    diagnostics: { fail: () => assert.fail("A successful update must not report a failure.") },
    logStage: entry => stages.push(entry),
  })
  assert.equal(
    result.interaction.correlationId,
    "telegram:901",
    "Every processed update must retain its stable Telegram correlation identifier.",
  )
  assert.equal(
    stages.at(-1).message,
    "Telegram interaction COMPLETED",
    "A successfully routed update must emit one completed interaction event.",
  )
})

test("retains a failed update and its interaction context for polling retry", async () => {
  const originalError = new Error("Telegram response delivery failed")
  const failures = []
  const result = await processTelegramUpdate({
    update: { update_id: 902, message: { text: "/status" } },
    respondToUpdate: async () => { throw originalError },
    diagnostics: { fail: request => failures.push(request) },
    logStage: () => {},
  })
  assert.equal(
    result.error,
    originalError,
    "The original response error must remain available to the poller so it does not advance the update offset.",
  )
  assert.equal(
    failures[0].interaction.correlationId,
    "telegram:902",
    "The failure diagnostic must retain the exact update correlation.",
  )
})

test("does not wait for a retry delay after the poll signal has been aborted", async () => {
  const controller = new AbortController()
  controller.abort()
  await waitForRetry({
    milliseconds: 30000,
    signal: controller.signal,
  })
  assert.equal(
    controller.signal.aborted,
    true,
    "Shutdown cancellation must release retry waiting immediately.",
  )
})

test("processes updates serially and advances the offset only after each completion", async () => {
  const controller = new AbortController()
  const processedUpdateIds = []
  const offsetState = { value: undefined }
  const diagnostics = { fail: () => {} }
  await pollTelegramOperatorUpdates({
    signal: controller.signal,
    offsetState,
    botUsername: "coinzilla_bot",
    callApi: async () => [
      { update_id: 10, message: { text: "/status" } },
      { update_id: 11, message: { text: "/markets" } },
    ],
    respondToUpdate: async ({ update }) => {
      processedUpdateIds.push(update.update_id)
      if (update.update_id === 11) {
        controller.abort()
      }
    },
    diagnostics,
    logger: { warn: () => {} },
    retryDelayMs: 1,
    pollTimeoutSeconds: 1,
    logStage: () => {},
  })
  assert.deepEqual(
    processedUpdateIds,
    [10, 11],
    "Telegram updates from one poll response must be processed in their original serial order.",
  )
  assert.equal(
    offsetState.value,
    12,
    "The polling offset must advance only after the final successfully processed update.",
  )
})
