import test from "node:test";
import assert from "node:assert/strict";
import { createConservativeVolatilityProtectionEligibility } from "./create-conservative-volatility-protection-eligibility.js";

const pairs = {
  DOGEUSDT: {
    enabled: true,
    enableVolatilityProtection: true,
  },
  DISABLEDUSDT: {
    enabled: false,
    enableVolatilityProtection: true,
  },
  OPTEDOUTUSDT: {
    enabled: true,
    enableVolatilityProtection: false,
  },
};

test("volatility protection eligibility requires an enabled Conservative pair", () => {
  const isEligible = createConservativeVolatilityProtectionEligibility({
    pairs,
    volatilityProtectionEnabled: true,
  });
  assert.equal(
    isEligible("DOGEUSDT"),
    true,
    "An enabled Conservative pair with protection configured must be eligible.",
  );
  assert.equal(
    isEligible("LINEAUSDT"),
    false,
    "An RS-only symbol absent from the Conservative pair map must not inherit protection.",
  );
  assert.equal(
    isEligible("DISABLEDUSDT"),
    false,
    "A disabled Conservative pair must not be eligible.",
  );
  assert.equal(
    isEligible("OPTEDOUTUSDT"),
    false,
    "A Conservative pair explicitly opting out must not be eligible.",
  );
  const isProtectionAvailable = createConservativeVolatilityProtectionEligibility({
    pairs,
    volatilityProtectionEnabled: false,
  });
  assert.equal(
    isProtectionAvailable("DOGEUSDT"),
    false,
    "Protection remains disabled when the candle-history service is unavailable.",
  );
});
