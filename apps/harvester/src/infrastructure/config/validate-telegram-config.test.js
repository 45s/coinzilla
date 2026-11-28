import test from "node:test"
import assert from "node:assert/strict"
import { ConfigValidationError } from "../../domain/app-config.js"
import { validateTelegramApplicationConfig } from "./validate-telegram-config.js"

test("validates Telegram notification profiles, markets and event overrides", () => {
  const valid = {
    notifications: {
      telegram: {
        enabled: true,
        profile: "custom",
        markets: ["LINKUSDT"],
        events: { fillReceived: true },
      },
    },
  }
  assert.equal(validateTelegramApplicationConfig(valid), valid)
  assert.throws(
    () => validateTelegramApplicationConfig({ notifications: { telegram: { profile: "unknown" } } }),
    /profile/,
  )
  assert.throws(
    () => validateTelegramApplicationConfig({ notifications: { telegram: { events: { unknownEvent: true } } } }),
    /events/,
  )
  assert.throws(
    () => validateTelegramApplicationConfig({ notifications: { telegram: { events: { fillReceived: "yes" } } } }),
    /boolean/,
  )
  assert.throws(
    () => validateTelegramApplicationConfig({ notifications: { telegram: { markets: ["LINKUSDT", "LINKUSDT"] } } }),
    /markets/,
  )
  assert.throws(
    () => validateTelegramApplicationConfig({ notifications: { telegram: { markets: [""] } } }),
    /markets/,
  )
})

test("validates Telegram operator-control allowlists and fields", () => {
  const valid = {
    operatorControl: {
      telegram: {
        enabled: true,
        allowedUserIds: ["12345"],
      },
    },
  }
  assert.equal(validateTelegramApplicationConfig(valid), valid)
  for (const invalid of [["0"], ["01"], ["-1"], ["bad"], [12345], ["12345", "12345"]]) {
    assert.throws(
      () => validateTelegramApplicationConfig({ operatorControl: { telegram: { enabled: false, allowedUserIds: invalid } } }),
      (error) => error instanceof ConfigValidationError && error.path === "operatorControl.telegram.allowedUserIds",
    )
  }
  assert.throws(
    () => validateTelegramApplicationConfig({ operatorControl: { telegram: { enabled: "true", allowedUserIds: [] } } }),
    (error) => error.path === "operatorControl.telegram.enabled",
  )
  assert.throws(
    () => validateTelegramApplicationConfig({ operatorControl: { telegram: { enabled: false, allowedUserIds: [], chatId: "x" } } }),
    (error) => error.path === "operatorControl.telegram.chatId",
  )
})
