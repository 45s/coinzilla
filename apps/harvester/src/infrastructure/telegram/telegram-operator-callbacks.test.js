import assert from "node:assert/strict"
import test from "node:test"
import {
  handleCancelCallback,
  handleConfirmationCallback,
} from "./telegram-operator-callbacks.js"

function createConfirmationRequest({ acknowledgement,
 pendingExpiresAt = Date.now() + 60000 } = {}) {
  const pendingConfirmations = new Map([[
    "42",
    {
      action: "PAUSE",
      symbol: "LINKUSDT",
      userId: "123",
      chatId: "123",
      messageId: 7,
      expiresAt: pendingExpiresAt,
    },
  ]])
  const executedControls = []
  const callbackAnswers = []
  const editedMessages = []
  const interaction = { action: "UNKNOWN",
 symbol: undefined }
  return {
    pendingConfirmations,
    executedControls,
    callbackAnswers,
    editedMessages,
    request: {
      confirm: ["cc:confirm:PAUSE:LINKUSDT:42", "PAUSE", "LINKUSDT", "42"],
      callback: { id: "callback-42" },
      chat: { id: 123 },
      messageId: 7,
      userId: "123",
      signal: new AbortController().signal,
      interaction,
      logStage: () => {},
      pendingConfirmations,
      answerCallback: async request => {
        callbackAnswers.push(request)
        return acknowledgement
      },
      editMessage: async request => editedMessages.push(request),
      executeControl: async request => executedControls.push(request),
      buildNavigationKeyboard: () => ({ inline_keyboard: [] }),
    },
  }
}

test("executes a valid one-time confirmation only after Telegram acknowledges it", async () => {
  const fixture = createConfirmationRequest({ acknowledgement: true })
  await handleConfirmationCallback(fixture.request)
  assert.equal(
    fixture.executedControls.length,
    1,
    "A valid acknowledged confirmation must invoke exactly one application control.",
  )
  assert.equal(
    fixture.pendingConfirmations.size,
    0,
    "A successfully acknowledged confirmation must be consumed before control execution.",
  )
  assert.equal(
    fixture.executedControls[0].requestId,
    "telegram:callback:callback-42",
    "The application request identity must be derived from the confirming callback.",
  )
})

test("retains a valid confirmation when Telegram acknowledgement fails", async () => {
  const fixture = createConfirmationRequest({ acknowledgement: undefined })
  await handleConfirmationCallback(fixture.request)
  assert.equal(
    fixture.pendingConfirmations.size,
    1,
    "A confirmation must remain pending when its callback acknowledgement is not confirmed.",
  )
  assert.equal(
    fixture.executedControls.length,
    0,
    "No state-changing application operation may run before callback acknowledgement succeeds.",
  )
})

test("rejects expired confirmations without invoking the application", async () => {
  const fixture = createConfirmationRequest({
    acknowledgement: true,
    pendingExpiresAt: Date.now() - 1,
  })
  await handleConfirmationCallback(fixture.request)
  assert.equal(
    fixture.executedControls.length,
    0,
    "An expired confirmation must never invoke a pause or resume use case.",
  )
  assert.equal(
    fixture.pendingConfirmations.size,
    0,
    "An expired confirmation token must be removed so it cannot be replayed.",
  )
  assert.match(
    fixture.editedMessages[0].text,
    /No action was taken/,
    "The operator must be told that an expired confirmation did not change application state.",
  )
})

test("cancels a pending confirmation without invoking the application", async () => {
  const fixture = createConfirmationRequest()
  const request = {
    ...fixture.request,
    cancel: ["cc:cancel:42", "42"],
  }
  delete request.confirm
  await handleCancelCallback(request)
  assert.equal(
    fixture.pendingConfirmations.size,
    0,
    "A matching cancel action must remove the pending confirmation.",
  )
  assert.equal(
    fixture.executedControls.length,
    0,
    "Cancelling a confirmation must not invoke the application control.",
  )
})
