import assert from "node:assert/strict"
import test from "node:test"
import {
  assertHttpResponse,
  getHttpStatus,
  createHttpFailure,
  validateSuccessfulPayload,
} from "./validate-telegram-api-response.js"

test("validates HTTP response shape and returns safe status values", () => {
  assert.doesNotThrow(() => assertHttpResponse({
    ok: true,
status: 200,
json: async () => ({}),
  }))
  assert.throws(() => assertHttpResponse({ ok: "yes" }), TypeError)
  assert.equal(getHttpStatus({ status: 200 }), 200)
  assert.equal(getHttpStatus({ status: "200" }), "unknown")
})

test("creates HTTP failure with token redacted from provider description", () => {
  const error = createHttpFailure({
    payload: { description: "bad token secret-value" },
status: 401,
token: "secret-value",
  })

  assert.match(error.message, /401/)
  assert.doesNotMatch(error.message, /secret-value/)
})

test("validates successful Telegram payload and message identity", () => {
  const payload = {
    ok: true,
result: { message_id: 7,
text: "hello" },
  }
  assert.equal(validateSuccessfulPayload({ payload,
token: "token" }), payload.result)
  assert.throws(() => validateSuccessfulPayload({ payload: { ok: false },
token: "token" }))
  assert.throws(() => validateSuccessfulPayload({
    payload: { ok: true,
result: { message_id: 0 } },
token: "token",
  }), TypeError)
})
