import test from "node:test"
import assert from "node:assert/strict"
import { resolveTelegramOperatorConfig, TelegramUserIdConfigurationError } from "./resolve-telegram-operator-config.js"

const config = (ids = [], enabled = true) => ({ operatorControl: { telegram: { enabled, allowedUserIds: ids } } })

test("adds TELEGRAM_USER_ID to allowedUserIds and preserves configured IDs without mutation", () => {
  const input = config(["11111"])
  const result = resolveTelegramOperatorConfig({ appConfig: input, env: { TELEGRAM_USER_ID: "123456789" } })
  assert.deepEqual(result.operatorControl.telegram.allowedUserIds, ["11111", "123456789"])
  assert.deepEqual(input.operatorControl.telegram.allowedUserIds, ["11111"])
})

test("does not duplicate an environment user ID already in the allowlist", () => {
  const result = resolveTelegramOperatorConfig({ appConfig: config(["12345"]), env: { TELEGRAM_USER_ID: "12345" } })
  assert.deepEqual(result.operatorControl.telegram.allowedUserIds, ["12345"])
})

test("accepts an absent or empty environment value when a configured allowlist exists", () => {
  for (const value of [undefined, ""]) {
    const result = resolveTelegramOperatorConfig({ appConfig: config(["12345"]), env: { TELEGRAM_USER_ID: value } })
    assert.deepEqual(result.operatorControl.telegram.allowedUserIds, ["12345"])
  }
})

test("rejects invalid TELEGRAM_USER_ID values with a specific error code", () => {
  for (const value of ["abc", "0", "-123", "0123", " 123 ", "9007199254740992", 123]) {
    assert.throws(
      () => resolveTelegramOperatorConfig({ appConfig: config(), env: { TELEGRAM_USER_ID: value } }),
      (error) => error instanceof TelegramUserIdConfigurationError &&
        error.code === "TELEGRAM_USER_ID_INVALID" && error.message.includes("TELEGRAM_USER_ID"),
    )
  }
})

test("requires a non-empty resolved allowlist when operator control is enabled", () => {
  assert.throws(
    () => resolveTelegramOperatorConfig({ appConfig: config(), env: {} }),
    (error) => error.code === "TELEGRAM_OPERATOR_ALLOWLIST_REQUIRED" &&
      error.message.includes("operatorControl.telegram.allowedUserIds"),
  )
})

test("reports malformed configured IDs and duplicates precisely", () => {
  assert.throws(
    () => resolveTelegramOperatorConfig({ appConfig: config(["bad"]) }),
    (error) => error.code === "TELEGRAM_OPERATOR_ALLOWLIST_INVALID" && error.message.includes("allowedUserIds[0]"),
  )
  assert.throws(
    () => resolveTelegramOperatorConfig({ appConfig: config(["12345", "12345"]) }),
    (error) => error.code === "TELEGRAM_OPERATOR_ALLOWLIST_DUPLICATE",
  )
})

test("does not enable operator control merely because TELEGRAM_USER_ID is set", () => {
  const result = resolveTelegramOperatorConfig({ appConfig: config([], false), env: { TELEGRAM_USER_ID: "12345" } })
  assert.equal(result.operatorControl.telegram.enabled, false)
  assert.deepEqual(result.operatorControl.telegram.allowedUserIds, ["12345"])
})
