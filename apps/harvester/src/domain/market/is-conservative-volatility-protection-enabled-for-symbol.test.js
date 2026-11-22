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
    isConservativeVolatilityProtectionEnabledForSymbol({
      pairs,
      symbol: "DOGEUSDT",
      volatilityProtectionEnabled: true,
    }),
    true,
    "An enabled Conservative pair with protection configured must be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol({
      pairs,
      symbol: "LINEAUSDT",
      volatilityProtectionEnabled: true,
    }),
    false,
    "An RS-only symbol absent from the Conservative pair map must not inherit protection.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol({
      pairs,
      symbol: "DISABLEDUSDT",
      volatilityProtectionEnabled: true,
    }),
    false,
    "A disabled Conservative pair must not be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol({
      pairs,
      symbol: "OPTEDOUTUSDT",
      volatilityProtectionEnabled: true,
    }),
    false,
    "A Conservative pair explicitly opting out must not be eligible.",
  );
  assert.equal(
    isConservativeVolatilityProtectionEnabledForSymbol({
      pairs,
      symbol: "DOGEUSDT",
      volatilityProtectionEnabled: false,
    }),
    false,
    "Protection remains disabled when the candle-history service is unavailable.",
  );
});
