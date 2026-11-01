const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const fail = (path, expectation) => {
  throw new TypeError(`Invalid trading config at "${path}": expected ${expectation}`);
};

const requireRecord = (value, path) => {
  if (!isRecord(value)) fail(path, 'an object');
};

const requireBoolean = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'a boolean');
};

const requireNumber = (value, path, { min = -Infinity, exclusiveMin = false } = {}) => {
  const validMinimum = exclusiveMin ? value > min : value >= min;

  if (typeof value !== 'number' || !Number.isFinite(value) || !validMinimum) {
    fail(path, exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}`);
  }
};

const requirePrecision = (value, path) => {
  if (!Number.isInteger(value) || value < 0) {
    fail(path, 'a non-negative integer');
  }
};

/**
 * Validate the supported trading-config shape and its basic numeric invariants.
 * Returns the original object so callers can pass the validated configuration
 * without silently changing values or dropping fields.
 */
export function validateTradingConfig(config) {
  requireRecord(config, 'root');
  requireRecord(config.strategies, 'strategies');

  const strategyEntries = Object.entries(config.strategies);
  if (strategyEntries.length === 0) {
    fail('strategies', 'at least one strategy');
  }

  for (const [strategyName, strategy] of strategyEntries) {
    const strategyPath = `strategies.${strategyName}`;
    if (!strategyName.trim()) fail('strategies', 'non-empty strategy names');
    requireRecord(strategy, strategyPath);
    requireBoolean(strategy.enabled, `${strategyPath}.enabled`);
    requireRecord(strategy.settings, `${strategyPath}.settings`);
    requireNumber(strategy.settings.minProfit, `${strategyPath}.settings.minProfit`, { min: 0 });
    requireRecord(strategy.pairs, `${strategyPath}.pairs`);

    const pairs = Object.entries(strategy.pairs);
    if (pairs.length === 0) fail(`${strategyPath}.pairs`, 'at least one pair');

    for (const [symbol, pair] of pairs) {
      const pairPath = `${strategyPath}.pairs.${symbol}`;
      if (!symbol.trim()) fail(`${strategyPath}.pairs`, 'non-empty pair symbols');
      requireRecord(pair, pairPath);
      requireBoolean(pair.enabled, `${pairPath}.enabled`);
      requireNumber(pair.orderQuantity, `${pairPath}.orderQuantity`, { min: 0, exclusiveMin: true });
      requireNumber(pair.keepQuantity, `${pairPath}.keepQuantity`, { min: 0 });
      requireNumber(pair.priceStepPercent, `${pairPath}.priceStepPercent`, { min: 0, exclusiveMin: true });
      requirePrecision(pair.pricePrecision, `${pairPath}.pricePrecision`);
      requirePrecision(pair.quantityPrecision, `${pairPath}.quantityPrecision`);
      requireNumber(pair.makerPercent, `${pairPath}.makerPercent`, { min: 0 });
      requireNumber(pair.takerPercent, `${pairPath}.takerPercent`, { min: 0 });
    }
  }

  return config;
}
