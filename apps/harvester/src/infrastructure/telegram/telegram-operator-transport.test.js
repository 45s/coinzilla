import assert from "node:assert/strict"
import test from "node:test"
import {
  createTelegramCallApi,
  createTelegramMessageApi,
} from "./telegram-operator-transport.js"

function createResponse({ ok = true,
 body,
 status = 200 }) {
  return {
    ok,
    status,
    async json() { return body },
  }
}

test("sends Telegram API requests with the token, JSON body and abort signal", async () => {
  const calls = []
  const callApi = createTelegramCallApi({
    botToken: "test-token",
    fetchImpl: async (...request) => {
      calls.push(request)
      return createResponse({ body: { ok: true,
 result: [{ update_id: 1 }] } })
    },
  })
  const { signal } = new AbortController()
  const result = await callApi({
    method: "getUpdates",
    payload: { timeout: 30 },
    signal,
  })
  assert.deepEqual(
    result,
    [{ update_id: 1 }],
    "Successful Telegram API calls must return only the Bot API result payload.",
  )
  const [[requestUrl, requestOptions]] = calls
  assert.equal(
    requestUrl,
    "https://api.telegram.org/bottest-token/getUpdates",
    "The API request must target the selected Bot API method using the injected bot token.",
  )
  assert.equal(
    requestOptions.signal,
    signal,
    "The caller's abort signal must reach the Telegram transport request.",
  )
})

test("preserves Telegram retry_after metadata on API errors", async () => {
  const callApi = createTelegramCallApi({
    botToken: "test-token",
    fetchImpl: async () => createResponse({
      ok: false,
      status: 429,
      body: {
        ok: false,
        description: "Too Many Requests",
        parameters: { retry_after: 3 },
      },
    }),
  })
  await assert.rejects(
    callApi({ method: "getUpdates",
 payload: {} }),
    error => error.retryAfter === 3,
    "Telegram rate-limit responses must preserve their retry_after duration for bounded polling backoff.",
  )
})

test("treats an unchanged Telegram message edit as successful delivery", async () => {
  const calls = []
  const messageApi = createTelegramMessageApi({
    callApi: async request => {
      calls.push(request)
      throw new Error("Bad Request: message is not modified")
    },
    logStage: () => {},
  })
  const result = await messageApi.editMessage({
    chatId: 123,
    messageId: 7,
    text: "Current page",
  })
  assert.equal(
    result,
    undefined,
    "An unchanged Telegram message must not cause the polling loop to retry a completed interaction.",
  )
  assert.equal(
    calls[0].method,
    "editMessageText",
    "Message edits must use the Telegram editMessageText endpoint.",
  )
})

test("does not fail an interaction when Telegram reports an expired callback acknowledgement", async () => {
  const stages = []
  const messageApi = createTelegramMessageApi({
    callApi: async () => {
      throw new Error("Bad Request: query is too old")
    },
    logStage: entry => stages.push(entry),
  })
  const result = await messageApi.answerCallback({
    callbackId: "callback-1",
    interaction: {},
  })
  assert.equal(
    result,
    undefined,
    "An expired callback acknowledgement must be classified as expired rather than retried as a transport failure.",
  )
  assert.equal(
    stages[0].message,
    "Telegram callback acknowledgement EXPIRED",
    "The transport must emit the explicit expired-acknowledgement diagnostic.",
  )
})
