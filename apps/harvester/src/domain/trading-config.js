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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'a finite number');
  }

  const validMinimum = exclusiveMin ? value > min : value >= min;

  if (!validMinimum) {
    fail(path, exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}`);
  }
};

const requirePrecision = (value, path) => {
  if (!Number.isInteger(value) || value < 0) {
    fail(path, 'a non-negative integer');
  }
};

/**
 * Validate Harvester's flat trading-config shape and basic numeric invariants.
 * Each market pair owns its capital allocation and trading parameters.
 * Returns the original object without silently changing values or dropping fields.
 */
export function validateTradingConfig(config) {
  requireRecord(config, 'root');
  requireRecord(config.settings, 'settings');
  requireNumber(config.settings.minProfit, 'settings.minProfit', { min: 0 });
  requireRecord(config.pairs, 'pairs');

  const pairs = Object.entries(config.pairs);
  if (pairs.length === 0) fail('pairs', 'at least one pair');

  for (const [symbol, pair] of pairs) {
    const pairPath = `pairs.${symbol}`;
    if (!symbol.trim()) fail('pairs', 'non-empty pair symbols');
    requireRecord(pair, pairPath);
    requireBoolean(pair.enabled, `${pairPath}.enabled`);
    requireNumber(pair.investment, `${pairPath}.investment`, { min: 0, exclusiveMin: true });
    requireNumber(pair.orderQuantity, `${pairPath}.orderQuantity`, { min: 0, exclusiveMin: true });
    requireNumber(pair.keepQuantity, `${pairPath}.keepQuantity`, { min: 0 });
    requireNumber(pair.priceStepPercent, `${pairPath}.priceStepPercent`, { min: 0, exclusiveMin: true });
    requirePrecision(pair.pricePrecision, `${pairPath}.pricePrecision`);
    requirePrecision(pair.quantityPrecision, `${pairPath}.quantityPrecision`);
    requireNumber(pair.makerPercent, `${pairPath}.makerPercent`, { min: 0 });
    requireNumber(pair.takerPercent, `${pairPath}.takerPercent`, { min: 0 });
  }

  return config;
}
