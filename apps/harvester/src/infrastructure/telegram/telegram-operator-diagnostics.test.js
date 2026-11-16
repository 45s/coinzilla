import assert from "node:assert/strict"
import test from "node:test"
import { createTelegramOperatorDiagnostics } from "./telegram-operator-diagnostics.js"

test("preserves nested error details while redacting bot tokens and excluding Telegram identities", () => {
  const botToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
  const cause = new TypeError(`request failed for ${botToken}`)
  const error = Object.assign(
    new Error(`Telegram API request failed: sendMessage ${botToken}`, { cause }),
    {
      code: "TELEGRAM_SEND_FAILED",
      context: {
        component: "harvester.operator",
        operation: "sendMessage",
        symbol: "LINKUSDT",
        userId: "12345",
        chatId: "12345",
      },
    },
  )
  const diagnostics = createTelegramOperatorDiagnostics({ botToken })
  const details = diagnostics.describeError(error)
  const serialized = JSON.stringify(details)
  assert.equal(serialized.includes(botToken), false)
  assert.equal(details.code, "TELEGRAM_SEND_FAILED")
  assert.equal(details.cause.message.includes("[REDACTED]"), true)
  assert.deepEqual(details.context, {
    component: "harvester.operator",
    operation: "sendMessage",
    symbol: "LINKUSDT",
  })
  assert.equal(serialized.includes("12345"), false)
})

test("reports non-exception failures with a classification and safe context", () => {
  const entries = []
  const interaction = {
    correlationId: "telegram:report",
    interactionType: "message",
    action: "MARKETS",
    loggedErrors: new Set(),
  }
  const diagnostics = createTelegramOperatorDiagnostics({
    logger: {
      error: entry => entries.push(entry),
    },
  })
  const failure = {
    interaction,
    stage: "QUERY_RESULT",
    operation: "getMarkets",
    symbol: "LINKUSDT",
    classification: "OPERATOR_QUERY_FAILED",
    message: "Market query returned no diagnostic error.",
  }
  assert.equal(diagnostics.report(failure), true)
  assert.equal(diagnostics.report(failure), false)
  assert.equal(interaction.failed, true)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].failureClassification, "OPERATOR_QUERY_FAILED")
  assert.equal(entries[0].errorMessage, "Market query returned no diagnostic error.")
  assert.equal(entries[0].operation, "getMarkets")
  assert.equal(entries[0].symbol, "LINKUSDT")
  assert.equal(entries[0].errorName, undefined)
})

test("logs a rejected interaction and safely ignores logger failures", () => {
  const interaction = {
    correlationId: "telegram:1",
    interactionType: "callback",
    action: "PAUSE",
    loggedErrors: new Set(),
  }
  const diagnostics = createTelegramOperatorDiagnostics({
    logger: {
      warn: () => {
        throw new Error("logger failure")
      },
    },
  })
  const entry = diagnostics.log({
    interaction,
    message: "Telegram interaction REJECTED",
    level: "warn",
    fields: {
      stage: "AUTHORIZATION",
      reason: "USER_NOT_ALLOWLISTED",
    },
  })
  assert.equal(interaction.rejected, true)
  assert.equal(interaction.stage, "AUTHORIZATION")
  assert.equal(entry.correlationId, "telegram:1")
  assert.equal(entry.reason, "USER_NOT_ALLOWLISTED")
})

test("logs a failure once with the original error and safe operation context", () => {
  const entries = []
  const interaction = {
    correlationId: "telegram:2",
    interactionType: "message",
    action: "MARKETS",
    operation: "getMarkets",
    symbol: "LINKUSDT",
    loggedErrors: new Set(),
  }
  const error = Object.assign(new Error("market query failed"), {
    code: "MARKET_QUERY_FAILED",
    context: {
      component: "harvester.operator",
      operation: "getMarkets",
      symbol: "LINKUSDT",
      userId: "12345",
    },
  })
  const diagnostics = createTelegramOperatorDiagnostics({
    logger: {
      error: entry => entries.push(entry),
    },
  })
  assert.equal(diagnostics.fail({
    interaction,
    error,
    stage: "QUERY_EXECUTION",
  }), true)
  assert.equal(diagnostics.fail({
    interaction,
    error,
    stage: "QUERY_EXECUTION",
  }), false)
  assert.equal(entries.length, 1)
  assert.equal(interaction.failed, true)
  assert.equal(entries[0].correlationId, "telegram:2")
  assert.equal(entries[0].operation, "getMarkets")
  assert.equal(entries[0].symbol, "LINKUSDT")
  assert.equal(entries[0].errorCode, "MARKET_QUERY_FAILED")
  assert.equal(entries[0].errorContext.userId, undefined)
})

test("preserves nested causes and error arrays while handling circular and deep causes", () => {
  const diagnostics = createTelegramOperatorDiagnostics()
  const circular = new Error("circular")
  circular.cause = circular
  const circularDetails = diagnostics.describeError(circular)
  assert.equal(circularDetails.cause.message, "[Circular error cause]")

  const root = new Error("root")
  let current = root
  for (let index = 0; index < 6; index += 1) {
    current.cause = new Error(`cause ${index}`)
    current = current.cause
  }
  const deepDetails = diagnostics.describeError(root)
  let nested = deepDetails
  for (let index = 0; index < 5; index += 1) {
    nested = nested.cause
  }
  assert.equal(nested.message, "[Error cause depth limit reached]")

  const aggregate = Object.assign(new Error("aggregate"), {
    errors: [new TypeError("first nested error"), new RangeError("second nested error")],
  })
  const aggregateDetails = diagnostics.describeError(aggregate)
  assert.equal(aggregateDetails.errors.length, 2)
  assert.equal(aggregateDetails.errors[0].name, "TypeError")
  assert.equal(aggregateDetails.errors[1].name, "RangeError")
})

test("ignores unsafe context shapes and redacts token-like values in error messages", () => {
  const diagnostics = createTelegramOperatorDiagnostics()
  const error = Object.assign(
    new Error("failed token=abc123 Bearer abcdefghijklmnop"),
    {
      context: ["unsafe", "array"],
    },
  )
  const details = diagnostics.describeError(error)
  assert.equal(details.context, undefined)
  assert.equal(details.message.includes("token=abc123"), false)
  assert.equal(details.message.includes("Bearer abcdefghijklmnop"), false)
})

test("handles primitive errors, missing loggers, and throwing error property accessors", () => {
  const diagnostics = createTelegramOperatorDiagnostics()
  assert.deepEqual(diagnostics.describeError("plain failure"), {
    message: "plain failure",
  })
  assert.deepEqual(diagnostics.describeError(null), {
    message: "null",
  })
  const error = new Error("getter failure")
  Object.defineProperty(error, "cause", {
    get() {
      throw new Error("unreadable cause")
    },
  })
  const details = diagnostics.describeError(error)
  assert.equal(details.message, "getter failure")
  assert.equal(details.cause, undefined)
  const entry = diagnostics.log({
    message: "Telegram update RECEIVED",
    fields: {
      stage: "UPDATE_RECEIVED",
    },
  })
  assert.equal(entry.message, "Telegram update RECEIVED")
  assert.equal(entry.stage, "UPDATE_RECEIVED")
})
