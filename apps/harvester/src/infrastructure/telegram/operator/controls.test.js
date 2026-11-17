import assert from "node:assert/strict"
import test from "node:test"
import {
  buildControlReply,
  executeTelegramOperatorControl,
} from "./controls.js"

function createDiagnostics() {
  return {
    failures: [],
    reports: [],
    fail(request) { this.failures.push(request) },
    report(request) { this.reports.push(request) },
  }
}

test("maps global emergency BUY pause to the application facade and reports its outcome", async () => {
  const diagnostics = createDiagnostics()
  const calls = []
  const sentMessages = []
  const interaction = {
    failed: false,
    applicationOperationInvoked: false,
    applicationOperationCompleted: false,
    stateChanged: false,
  }
  await executeTelegramOperatorControl({
    action: "PAUSE_ALL_BUYS",
    userId: "123",
    requestId: "telegram:501",
    chatId: 123,
    interaction,
    operator: {
      pauseAllBuys: async request => {
        calls.push(request)
        return {
          ok: true,
          data: { paused: true,
 canceled: 2,
 reconciled: 1,
 alreadyPaused: false },
        }
      },
    },
    diagnostics,
    logStage: () => {},
    sendMessage: async request => sentMessages.push(request),
    editMessage: async () => {},
    buildNavigationKeyboard: () => ({ inline_keyboard: [] }),
  })
  assert.equal(
    calls.length,
    1,
    "A global BUY pause must invoke exactly one application-owned pauseAllBuys use case.",
  )
  assert.deepEqual(
    calls[0],
    {
      actor: { id: "telegram-user:123",
 roles: ["trading-operator"] },
      requestId: "telegram:501",
      symbol: undefined,
    },
    "The transport must pass the authenticated actor and stable request identity to the application facade.",
  )
  assert.match(
    sentMessages[0].text,
    /Cancelled 2 Harvester-owned BUY order/,
    "The operator response must report the confirmed cancellation count returned by the application.",
  )
  assert.equal(
    interaction.stateChanged,
    true,
    "A newly activated emergency BUY pause must be recorded as a state change.",
  )
})

test("reports unresolved owned-BUY cancellation without claiming full cancellation", () => {
  const interaction = { failed: false }
  const diagnostics = createDiagnostics()
  const reply = buildControlReply({
    action: "PAUSE_BUYS",
    symbol: "LINKUSDT",
    result: {
      ok: false,
      errors: [{ code: "OPERATOR_BUY_CANCELLATION_INCOMPLETE" }],
    },
    method: "pauseBuys",
    interaction,
    diagnostics,
  })
  assert.match(
    reply,
    /cancellation of one or more Harvester-owned BUY orders is unresolved/,
    "An incomplete cancellation result must warn that owned BUY orders may remain unresolved.",
  )
  assert.equal(
    interaction.stateChanged,
    true,
    "The emergency BUY gate must remain reported as active when cancellation is incomplete.",
  )
})

test("preserves the existing non-canceling market pause contract", () => {
  const reply = buildControlReply({
    action: "PAUSE",
    symbol: "LINKUSDT",
    result: { ok: true,
 data: { paused: true,
 alreadyPaused: false } },
    method: "pauseMarket",
    interaction: { failed: false },
    diagnostics: createDiagnostics(),
  })
  assert.match(
    reply,
    /Existing exchange orders remain open and may still fill/,
    "The legacy market pause response must not imply that existing exchange orders were cancelled.",
  )
})
