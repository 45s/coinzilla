/**
 * Create a Conservative volatility eligibility predicate for the effective CG pair map.
 * Shared market-data symbols do not imply Conservative strategy ownership.
 *
 * @param {{pairs: object, volatilityProtectionEnabled: boolean}} options
 * @returns {(symbol: string) => boolean} Eligibility predicate for a CG market.
 */
export function createConservativeVolatilityProtectionEligibility({
  pairs,
  volatilityProtectionEnabled,
} = {}) {
  return (symbol) => {
    if (volatilityProtectionEnabled !== true) {
      return false;
    }
    const pairConfig = pairs?.[symbol];
    return pairConfig?.enabled === true && pairConfig.enableVolatilityProtection !== false;
  };
}
