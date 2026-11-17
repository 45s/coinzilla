import assert from "node:assert/strict"
import test from "node:test"
import {
  startTelegramOperatorAdapter,
  stopTelegramOperatorAdapter,
} from "./telegram-operator-lifecycle.js"

function createLifecycleState() {
  return {
    botUsername: undefined,
    offsetState: { value: 19 },
    controller: undefined,
    pollPromise: undefined,
    startPromise: undefined,
    stopPromise: undefined,
  }
}

test("starts the poller after bot identity and command-menu registration", async () => {
  const state = createLifecycleState()
  const calls = []
  let pollSignal
  const result = await startTelegramOperatorAdapter({
    state,
    callApi: async request => {
      calls.push(request.method)
      if (request.method === "getMe") {
        return { username: "coinzilla_bot" }
      }
      return true
    },
    logger: { warn: () => {} },
    diagnostics: { describeError: error => ({ message: error.message }) },
    poll: ({ signal }) => {
      pollSignal = signal
      return new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))
    },
  })
  assert.deepEqual(
    calls,
    ["getMe", "setMyCommands"],
    "The adapter must verify its Telegram identity and register commands before polling begins.",
  )
  assert.equal(
    state.botUsername,
    "coinzilla_bot",
    "The verified bot username must be stored for command-address validation.",
  )
  assert.equal(
    pollSignal.aborted,
    false,
    "The update poller must receive the active lifecycle abort signal.",
  )
  assert.equal(
    result.started,
    true,
    "The first successful startup must report that the adapter started.",
  )
})

test("shares concurrent shutdown and clears poller-owned state after cancellation", async () => {
  const state = createLifecycleState()
  const pendingConfirmations = new Map([["42", { action: "PAUSE" }]])
  let pollSignal
  const start = startTelegramOperatorAdapter({
    state,
    callApi: async request => request.method === "getMe"
      ? { username: "coinzilla_bot" }
      : true,
    logger: { warn: () => {} },
    diagnostics: { describeError: error => ({ message: error.message }) },
    poll: ({ signal }) => {
      pollSignal = signal
      return new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))
    },
  })
  await start
  const firstStop = stopTelegramOperatorAdapter({ state,
 pendingConfirmations })
  const secondStop = stopTelegramOperatorAdapter({ state,
 pendingConfirmations })
  const results = await Promise.all([firstStop, secondStop])
  assert.equal(
    pollSignal.aborted,
    true,
    "Stopping the adapter must abort its active long-poll lifecycle.",
  )
  assert.deepEqual(
    results[0],
    { stopped: true,
 alreadyStopped: false },
    "The first shutdown must report that it stopped the running adapter.",
  )
  assert.deepEqual(
    results[1],
    results[0],
    "Concurrent shutdown callers must share the same shutdown result.",
  )
  assert.equal(
    pendingConfirmations.size,
    0,
    "Shutdown must discard every pending one-time confirmation.",
  )
  assert.equal(
    state.offsetState.value,
    undefined,
    "Shutdown must reset the update offset before a later adapter start.",
  )
  assert.equal(
    state.botUsername,
    undefined,
    "Shutdown must clear the verified bot identity from the stopped lifecycle.",
  )
})
