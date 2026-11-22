/**
 * Create a market-owned volatility-protection eligibility predicate.
 * Strategy execution routes do not determine market volatility ownership.
 *
 * @param {{markets: object, volatilityProtectionEnabled: boolean}} options
 * @returns {(symbol: string) => boolean} Eligibility predicate for a configured market.
 */
export function createMarketVolatilityProtectionEligibility({
  markets,
  volatilityProtectionEnabled,
} = {}) {
  return (symbol) => {
    if (volatilityProtectionEnabled !== true) {
      return false
    }
    const marketConfig = markets?.[symbol]
    return marketConfig?.enabled === true && marketConfig.enableVolatilityProtection !== false
  }
}
