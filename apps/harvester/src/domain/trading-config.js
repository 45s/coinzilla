const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (path, expectation) => { throw new TypeError(`Invalid trading config at "${path}": expected ${expectation}`); };
const requireRecord = (value, path) => { if (!isRecord(value)) fail(path, 'an object'); };
const requireBoolean = (value, path) => { if (typeof value !== 'boolean') fail(path, 'a boolean'); };
const requireNumber = (value, path, { min = -Infinity, exclusiveMin = false, max = Infinity, exclusiveMax = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number');
  const validMinimum = exclusiveMin ? value > min : value >= min;
  if (!validMinimum) fail(path, exclusiveMin ? `a finite number greater than ${min}` : `a finite number greater than or equal to ${min}`);
  const validMaximum = exclusiveMax ? value < max : value <= max;
  if (!validMaximum) fail(path, exclusiveMax ? `a finite number less than ${max}` : `a finite number less than or equal to ${max}`);
};
const requirePrecision = (value, path) => { if (!Number.isInteger(value) || value < 0) fail(path, 'a non-negative integer'); };

/** Validate CG_coinGrabber and its strategy-owned settings and pairs. */
export function validateTradingConfig(config) {
  requireRecord(config, 'root');
  requireRecord(config.strategies, 'strategies');
  requireRecord(config.strategies.CG_coinGrabber, 'strategies.CG_coinGrabber');
  const strategy = config.strategies.CG_coinGrabber;
  requireBoolean(strategy.enabled, 'strategies.CG_coinGrabber.enabled');
  if (!strategy.enabled) fail('strategies.CG_coinGrabber.enabled', 'CG_coinGrabber must remain enabled');
  requireRecord(strategy.settings, 'strategies.CG_coinGrabber.settings');
  const settingsPath = 'strategies.CG_coinGrabber.settings';
  requireNumber(strategy.settings.minProfit, `${settingsPath}.minProfit`, { min: 0 });
  requireRecord(strategy.settings.conservative, `${settingsPath}.conservative`);
  requireBoolean(strategy.settings.conservative.enabled, `${settingsPath}.conservative.enabled`);
  if (!strategy.settings.conservative.enabled) fail(`${settingsPath}.conservative.enabled`, 'Conservative must remain enabled');
  requireRecord(strategy.settings.aggressive, `${settingsPath}.aggressive`);
  requireBoolean(strategy.settings.aggressive.enabled, `${settingsPath}.aggressive.enabled`);
  if (strategy.settings.aggressive.enabled) fail(`${settingsPath}.aggressive.enabled`, 'Aggressive strategy is deferred and must remain disabled');
  requireRecord(strategy.pairs, 'strategies.CG_coinGrabber.pairs');
  const pairs = Object.entries(strategy.pairs);
  if (pairs.length === 0) fail('strategies.CG_coinGrabber.pairs', 'at least one pair');
  for (const [symbol, pair] of pairs) {
    const pairPath = `strategies.CG_coinGrabber.pairs.${symbol}`;
    if (!symbol.trim()) fail('strategies.CG_coinGrabber.pairs', 'non-empty pair symbols');
    requireRecord(pair, pairPath);
    requireBoolean(pair.enabled, `${pairPath}.enabled`);
    requireNumber(pair.investment, `${pairPath}.investment`, { min: 0, exclusiveMin: true });
    requireNumber(pair.orderQuantity, `${pairPath}.orderQuantity`, { min: 0, exclusiveMin: true });
    requireNumber(pair.keepQuantity, `${pairPath}.keepQuantity`, { min: 0 });
    requireNumber(pair.priceStepPercent, `${pairPath}.priceStepPercent`, { min: 0, exclusiveMin: true });
    requirePrecision(pair.pricePrecision, `${pairPath}.pricePrecision`);
    requirePrecision(pair.quantityPrecision, `${pairPath}.quantityPrecision`);
    requireNumber(pair.makerPercent, `${pairPath}.makerPercent`, { min: 0, max: 100, exclusiveMax: true });
    requireNumber(pair.takerPercent, `${pairPath}.takerPercent`, { min: 0, max: 100, exclusiveMax: true });
  }
  return config;
}
