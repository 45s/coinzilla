/**
 * Resolve Conservative volatility eligibility from strategy-owned pair configuration.
 * Shared market-data symbols do not imply Conservative strategy ownership.
 *
 * @param {object} pairs Conservative effective pair map.
 * @param {string} symbol Market symbol.
 * @param {boolean} volatilityProtectionEnabled Whether candle snapshots are available.
 * @returns {boolean} True when this enabled Conservative pair is eligible for protection.
 */
export function isConservativeVolatilityProtectionEnabledForSymbol(pairs, symbol, volatilityProtectionEnabled) {
  if (volatilityProtectionEnabled !== true) {
    return false;
  }
  const pairConfig = pairs?.[symbol];
  return pairConfig?.enabled === true && pairConfig.enableVolatilityProtection !== false;
}
