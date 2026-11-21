import assert from "node:assert/strict"
import test from "node:test"
import { RS_RECOVERY_SELLER_CONFIG } from "./rs-recovery-seller.js"

test("keeps Recovery Seller disabled in the default Harvester configuration", () => {
  assert.equal(
    RS_RECOVERY_SELLER_CONFIG.enabled,
    false,
    "Opening the runtime acceptance gate must not enable RS without an explicit configuration change.",
  )
})
