import assert from "node:assert/strict"
import test from "node:test"
import { appConfig } from "../../config/index.js"
import { validateAppConfig } from "./app-config.js"

test("keeps Recovery Seller explicitly disabled in the default application configuration", () => {
  assert.equal(
    appConfig.strategies.RS_recoverySeller?.enabled,
    false,
    "RS must be present as an independent strategy and disabled until an operator supplies valid legacy authorization.",
  )
  assert.equal(
    validateAppConfig(appConfig),
    appConfig,
    "The default application configuration must validate without enabling or authorizing RS.",
  )
})
