import test from "node:test";
import assert from "node:assert/strict";
import { isConservativeVolatilityProtectionEnabledForSymbol } from "./is-conservative-volatility-protection-enabled-for-symbol.js";

const pairs = {
  DOGEUSDT: { enabled: true, enableVolatilityProtection: true },
  DISABLEDUSDT: { enabled: false, enableVolatilityProtection: true },
  OPTEDOUTUSDT: { enabled: true, enableVolatilityProtection: false },
};

test("volatility protection eligibility requires an enabled Conservative pair", () => {
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol(pairs, "DOGEUSDT", true),
    true,
    "An enabled Conservative pair with protection configured must be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol(pairs, "LINEAUSDT", true),
    false,
    "An RS-only symbol absent from the Conservative pair map must not inherit protection.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol(pairs, "DISABLEDUSDT", true),
    false,
    "A disabled Conservative pair must not be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol(pairs, "OPTEDOUTUSDT", true),
    false,
    "A Conservative pair explicitly opting out must not be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol(pairs, "DOGEUSDT", false),
    false,
    "Protection remains disabled when the candle-history service is unavailable.",
  );
});
