import test from "node:test"
import assert from "node:assert/strict"
import { isHarvesterClientOrderId } from "./is-harvester-client-order-id.js"

test("recognizes the reserved Harvester client-order ID namespace", () => {
  assert.equal(isHarvesterClientOrderId("h-0123456789abcdef012345-7"), true, "Harvester's reserved order ID prefix must be recognized.")
  assert.equal(isHarvesterClientOrderId("h-0123456789abcdef012345-preflight-0"), true, "Harvester preflight order IDs must use the same reserved namespace.")
  assert.equal(isHarvesterClientOrderId("manual-order-7"), false, "Manual client IDs must remain external.")
  assert.equal(isHarvesterClientOrderId("web_123456"), false, "Web client IDs must remain external.")
  assert.equal(isHarvesterClientOrderId(undefined), false, "Missing client IDs must not be mistaken for Harvester IDs.")
})
