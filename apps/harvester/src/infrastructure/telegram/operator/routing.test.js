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


test("routes a confirmed RESUME callback using the stable market-action contract", async () => {
  const executedControls = []
  const pendingConfirmations = new Map([[
    "42",
    {
      action: "RESUME",
      symbol: "LINKUSDT",
      userId: "123",
      chatId: "123",
      messageId: 7,
      expiresAt: Date.now() + 60000,
    },
  ]])
  const context = {
    allowedUsers: new Set(["123"]),
    pendingConfirmations,
    logStage: () => {},
    answerCallback: async () => true,
    editMessage: async () => {},
    executeControl: async request => executedControls.push(request),
    buildNavigationKeyboard: () => ({ inline_keyboard: [] }),
  }

  await respondToTelegramCallback({
    update: {
      update_id: 1002,
      callback_query: {
        id: "callback-1002",
        data: "cc:confirm:RESUME:LINKUSDT:42",
        from: {
          id: 123,
          is_bot: false,
        },
        message: {
          message_id: 7,
          chat: {
            id: 123,
            type: "private",
          },
        },
      },
    },
    signal: new AbortController().signal,
    interaction: {},
    context,
  })

  assert.equal(executedControls.length, 1, "A valid confirmed callback must dispatch exactly one application control.")
  assert.equal(executedControls[0].action, "RESUME", "The callback route must preserve the established RESUME action value.")
  assert.equal(executedControls[0].symbol, "LINKUSDT", "The callback route must preserve the confirmed market.")
  assert.equal(pendingConfirmations.size, 0, "A successfully acknowledged confirmation must be consumed exactly once.")
})
