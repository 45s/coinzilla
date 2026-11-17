import assert from "node:assert/strict"
import test from "node:test"
import {
  callbackAuthorizationFailure,
  createTelegramInteraction,
  messageAuthorizationFailure,
  normalizeTelegramUserId,
  resolveCallbackAction,
} from "./telegram-operator-interaction.js"

test("normalizes only positive safe Telegram user identifiers", () => {
  assert.equal(
    normalizeTelegramUserId("000123"),
    "123",
    "Decimal Telegram identifiers must be canonicalized before allowlist comparison.",
  )
  assert.equal(
    normalizeTelegramUserId(123),
    "123",
    "Positive safe numeric Telegram identifiers must map to their decimal string form.",
  )
  for (const invalidIdentifier of [0, -1, "0", "12x", Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(
      normalizeTelegramUserId(invalidIdentifier),
      undefined,
      "Zero, negative, malformed and unsafe Telegram identifiers must never authorize an interaction.",
    )
  }
})

test("maps callback payloads to stable actions without accepting malformed payloads", () => {
  const scenarios = [
    ["cc:ask:PAUSE:LINKUSDT", { action: "PAUSE", symbol: "LINKUSDT" }],
    ["cc:confirm:RESUME:LINKUSDT:42", { action: "RESUME", symbol: "LINKUSDT" }],
    ["cc:nav:home", { action: "MENU" }],
    ["cc:refresh:balances", { action: "BALANCES" }],
    ["cc:cancel:42", { action: "CANCEL" }],
    ["cc:unknown:LINKUSDT", { action: "UNKNOWN" }],
  ]
  for (const [payload, expected] of scenarios) {
    assert.deepEqual(
      resolveCallbackAction(payload),
      expected,
      "Callback payloads must resolve to the documented action or UNKNOWN without guessing.",
    )
  }
})

test("correlates inbound message and callback interactions with their Telegram update", () => {
  const messageInteraction = createTelegramInteraction({
    update: { update_id: 501, message: { text: "/pause LINKUSDT" } },
  })
  const callbackInteraction = createTelegramInteraction({
    update: { update_id: 502, callback_query: { data: "cc:ask:PAUSE:LINKUSDT" } },
  })
  assert.equal(
    messageInteraction.correlationId,
    "telegram:501",
    "Message diagnostics must use the stable Telegram update identity.",
  )
  assert.equal(
    callbackInteraction.interactionType,
    "callback",
    "Callback interactions must retain their transport type for diagnostics.",
  )
  assert.equal(
    callbackInteraction.symbol,
    "LINKUSDT",
    "Callback diagnostics must retain the normalized market context.",
  )
})

test("rejects non-private, mismatched and non-allowlisted callback identities", () => {
  const allowedUsers = new Set(["123"])
  const callback = { id: "callback-1", from: { id: 123 } }
  assert.equal(
    callbackAuthorizationFailure({
      callback,
      chat: { type: "group" },
      userId: "123",
      chatId: "123",
      allowedUsers,
    }),
    "PRIVATE_CHAT_REQUIRED",
    "Group callbacks must be rejected before any application operation.",
  )
  assert.equal(
    callbackAuthorizationFailure({
      callback,
      chat: { type: "private" },
      userId: "123",
      chatId: "456",
      allowedUsers,
    }),
    "PRIVATE_CHAT_IDENTITY_MISMATCH",
    "A private chat must belong to the same allowlisted identity as its sender.",
  )
  assert.equal(
    callbackAuthorizationFailure({
      callback,
      chat: { type: "private" },
      userId: "999",
      chatId: "999",
      allowedUsers,
    }),
    "USER_NOT_ALLOWLISTED",
    "A valid private identity outside the allowlist must remain unauthorized.",
  )
})

test("rejects bot senders and non-private or mismatched message identities", () => {
  const message = { from: { is_bot: false }, chat: { type: "private" } }
  assert.equal(
    messageAuthorizationFailure({
      message: { ...message, from: { is_bot: true } },
      userId: "123",
      chatId: "123",
    }),
    "BOT_SENDER_NOT_ALLOWED",
    "Bot-originated messages must never be treated as human operator commands.",
  )
  assert.equal(
    messageAuthorizationFailure({
      message: { ...message, chat: { type: "group" } },
      userId: "123",
      chatId: "123",
    }),
    "PRIVATE_CHAT_REQUIRED",
    "Group messages must be rejected even when their sender is allowlisted.",
  )
  assert.equal(
    messageAuthorizationFailure({ message, userId: "123", chatId: "456" }),
    "PRIVATE_CHAT_IDENTITY_MISMATCH",
    "A message must originate from the sender's own private chat.",
  )
})
