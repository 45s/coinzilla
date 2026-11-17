import assert from "node:assert/strict"
import test from "node:test"
import { respondToTelegramCallback } from "./routing.js"

test("rejects an unauthorized callback before reading pages or invoking controls", async () => {
  const answeredCallbacks = []
  const pageReads = []
  const controlCalls = []
  const stages = []
  const context = {
    allowedUsers: new Set(["123"]),
    logStage: entry => stages.push(entry),
    answerCallback: async request => answeredCallbacks.push(request),
    editPage: async request => pageReads.push(request),
    executeControl: async request => controlCalls.push(request),
    buildNavigationKeyboard: () => ({ inline_keyboard: [] }),
  }
  await respondToTelegramCallback({
    update: {
      update_id: 1001,
      callback_query: {
        id: "callback-1001",
        data: "cc:nav:status",
        from: { id: 999,
 is_bot: false },
        message: {
          message_id: 8,
          chat: { id: 999,
 type: "private" },
        },
      },
    },
    signal: new AbortController().signal,
    interaction: {},
    context,
  })
  assert.equal(
    answeredCallbacks.length,
    1,
    "An unauthorized callback must receive a transport acknowledgement explaining the rejection.",
  )
  assert.equal(
    pageReads.length,
    0,
    "An unauthorized callback must not invoke a read-only application query.",
  )
  assert.equal(
    controlCalls.length,
    0,
    "An unauthorized callback must never invoke a state-changing application use case.",
  )
  assert.equal(
    stages[0].fields.reason,
    "USER_NOT_ALLOWLISTED",
    "The rejection diagnostic must identify the allowlist boundary that denied the callback.",
  )
})
