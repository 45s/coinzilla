import test from 'node:test';
import assert from 'node:assert/strict';
import { appConfig } from '../../config/index.js';
import { NOTIFICATIONS_TG_PROFILES } from '../../config/notifications-tg-profiles.js';
import { validateAppConfig } from '../../src/domain/app-config.js';
const validConfig = structuredClone(appConfig);
const strategy = (config) => config.strategies.CG_coinGrabber;
const marketPrecision = {
  LINKUSDT: { pricePrecision: 3, quantityPrecision: 2 },
  LINKFDUSD: { pricePrecision: 3, quantityPrecision: 2 },
  DOGEUSDT: { pricePrecision: 5, quantityPrecision: 0 },
  SOLFDUSD: { pricePrecision: 2, quantityPrecision: 3 },
  ZROUSDT: { pricePrecision: 3, quantityPrecision: 1 },
  ZROFDUSD: { pricePrecision: 3, quantityPrecision: 1 },
  ADAFDUSD: { pricePrecision: 4, quantityPrecision: 1 },
  WLDFDUSD: { pricePrecision: 4, quantityPrecision: 1 },
};
for (const [symbol, pair] of Object.entries(strategy(validConfig).pairs)) {
  Object.assign(pair, marketPrecision[symbol]);
}

test('accepts nested CG_coinGrabber config and preserves mode toggles', () => {
  assert.equal(validateAppConfig(validConfig), validConfig);
  assert.equal(Object.hasOwn(validConfig, 'runtime'), false, 'exchange selection must not be stored in the application config module');
  assert.equal(strategy(validConfig).enabled, true);
  assert.equal(strategy(validConfig).settings.minProfit, undefined);
  assert.equal(strategy(validConfig).pairs.LINKUSDT.minProfit, 0.1);
  assert.equal(strategy(validConfig).pairs.ZROUSDT.minProfit, 0.01);
  assert.equal(strategy(validConfig).settings.conservative.enabled, true);
  assert.equal(strategy(validConfig).settings.aggressive.enabled, false);
  assert.ok(strategy(validConfig).pairs.ZROUSDT);
  assert.equal(strategy(validConfig).pairs.ZROUSDT.makerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.ZROUSDT.takerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.SOLFDUSD.makerPercent, 0);
  assert.equal(strategy(validConfig).pairs.SOLFDUSD.takerPercent, 0.1);
  assert.equal(strategy(validConfig).pairs.ZROFDUSD.makerPercent, 0);
  assert.equal(strategy(validConfig).pairs.ZROFDUSD.takerPercent, 0.1);
  assert.equal('settings' in validConfig, false);
  assert.equal('pairs' in validConfig, false);
});

test('requires at least 0.01 quote units of minimum profit on every pair', () => {
  for (const minProfit of [0, 0.009, -0.01, NaN, Infinity]) {
    const config = structuredClone(validConfig);
    strategy(config).pairs.LINKUSDT.minProfit = minProfit;
    assert.throws(() => validateAppConfig(config), /minProfit/);
  }
  const boundary = structuredClone(validConfig);
  strategy(boundary).pairs.LINKUSDT.minProfit = 0.01;
  assert.equal(validateAppConfig(boundary), boundary);
});

test('rejects the removed global minimum-profit setting', () => {
  const config = structuredClone(validConfig);
  strategy(config).settings.minProfit = 0.01;
  assert.throws(() => validateAppConfig(config), /settings.*minProfit.*configured on each market pair/);
});

test('rejects enabling the deferred Aggressive mode', () => {
  const config = structuredClone(validConfig);
  strategy(config).settings.aggressive.enabled = true;
  assert.throws(() => validateAppConfig(config), /settings.*aggressive.*enabled.*Aggressive strategy is deferred/);
});

test('requires enabled CG_coinGrabber and Conservative mode', () => {
  const strategyDisabled = structuredClone(validConfig);
  strategy(strategyDisabled).enabled = false;
  assert.throws(() => validateAppConfig(strategyDisabled), /CG_coinGrabber.*enabled.*must remain enabled/);
  const conservativeDisabled = structuredClone(validConfig);
  strategy(conservativeDisabled).settings.conservative.enabled = false;
  assert.throws(() => validateAppConfig(conservativeDisabled), /settings.*conservative.*enabled.*Conservative must remain enabled/);
});

test('rejects legacy flat settings/pairs and missing strategy-owned objects', () => {
  assert.throws(() => validateAppConfig({ settings: { minProfit: 0.01 }, pairs: {} }), /strategies.*expected an object/);
  const noSettings = structuredClone(validConfig); delete strategy(noSettings).settings;
  assert.throws(() => validateAppConfig(noSettings), /CG_coinGrabber.*settings.*expected an object/);
  const noPairs = structuredClone(validConfig); delete strategy(noPairs).pairs;
  assert.throws(() => validateAppConfig(noPairs), /CG_coinGrabber.*pairs.*expected an object/);
});

test('rejects priceStepPercent values that make the calculated BUY price invalid', () => {
  for (const priceStepPercent of [100, 100.01, 150]) {
    const config = structuredClone(validConfig);
    strategy(config).pairs.DOGEUSDT.priceStepPercent = priceStepPercent;
    assert.throws(() => validateAppConfig(config), /priceStepPercent.*less than 100/);
  }
  const boundary = structuredClone(validConfig);
  strategy(boundary).pairs.DOGEUSDT.priceStepPercent = 99.999;
  assert.equal(validateAppConfig(boundary), boundary);
});

test('rejects empty pairs', () => {
  const config = structuredClone(validConfig); strategy(config).pairs = {};
  assert.throws(() => validateAppConfig(config), /CG_coinGrabber.*pairs.*at least one pair/);
});

test('rejects invalid pair enabled flags, amounts, fees, and precision', () => {
  const invalidEnabled = structuredClone(validConfig); strategy(invalidEnabled).pairs.DOGEUSDT.enabled = 'true';
  assert.throws(() => validateAppConfig(invalidEnabled), /pairs.*DOGEUSDT.*enabled.*expected a boolean/);
  const invalidInvestment = structuredClone(validConfig); strategy(invalidInvestment).pairs.DOGEUSDT.investment = 0;
  assert.throws(() => validateAppConfig(invalidInvestment), /investment.*greater than 0/);
  const invalidOrderQuantity = structuredClone(validConfig); strategy(invalidOrderQuantity).pairs.DOGEUSDT.orderQuantity = 0;
  assert.throws(() => validateAppConfig(invalidOrderQuantity), /orderQuantity.*greater than 0/);
  const negativeFee = structuredClone(validConfig); strategy(negativeFee).pairs.DOGEUSDT.makerPercent = -0.01;
  assert.throws(() => validateAppConfig(negativeFee), /makerPercent/);
  const makerFeeAtUpperBound = structuredClone(validConfig); strategy(makerFeeAtUpperBound).pairs.DOGEUSDT.makerPercent = 100;
  assert.throws(() => validateAppConfig(makerFeeAtUpperBound), /makerPercent.*less than 100/);
  const takerFeeAtUpperBound = structuredClone(validConfig); strategy(takerFeeAtUpperBound).pairs.DOGEUSDT.takerPercent = 100;
  assert.throws(() => validateAppConfig(takerFeeAtUpperBound), /takerPercent.*less than 100/);
  const highestValidFees = structuredClone(validConfig);
  strategy(highestValidFees).pairs.DOGEUSDT.makerPercent = 99.999;
  strategy(highestValidFees).pairs.DOGEUSDT.takerPercent = 99.999;
  assert.equal(validateAppConfig(highestValidFees), highestValidFees);
  const invalidPrecision = structuredClone(validConfig); strategy(invalidPrecision).pairs.DOGEUSDT.pricePrecision = 1.5;
  assert.throws(() => validateAppConfig(invalidPrecision), /pricePrecision/);
});


test("the default app config includes the trader Telegram profile without credentials", () => {
  assert.equal(
    validConfig.notifications.telegram.enabled,
    true,
    "Telegram policy must be enabled in the single config while transport credentials remain external.",
  )
  assert.equal(
    validConfig.notifications.telegram.profile,
    NOTIFICATIONS_TG_PROFILES.TRADER,
    "The default Telegram profile must use the named trader profile constant without verbose event noise.",
  )
  assert.deepEqual(
    validConfig.notifications.telegram.markets,
    [],
    "An empty Telegram market list must mean all configured markets rather than silently suppressing alerts.",
  )
  assert.deepEqual(
    validConfig.notifications.telegram.events,
    {},
    "The default profile must not require custom overrides.",
  )
})

test("accepts different enabled-market selections without freezing deployment-specific symbols", () => {
  const config = structuredClone(validConfig);
  const pairs = Object.values(strategy(config).pairs);

  for (const pairConfig of pairs) {
    pairConfig.enabled = false;
  }
  pairs[0].enabled = true;
  assert.equal(
    validateAppConfig(config),
    config,
    "A valid configuration with one selected market must not depend on a hard-coded market name.",
  );

  pairs[0].enabled = false;
  pairs[1].enabled = true;
  assert.equal(
    validateAppConfig(config),
    config,
    "Changing the selected market must remain a configuration edit, not require rewriting a unit-test snapshot.",
  );
});

test("keeps named Telegram notification profile identifiers immutable", () => {
  assert.ok(
    Object.isFrozen(NOTIFICATIONS_TG_PROFILES),
    "Notification profile identifiers must be exposed as an immutable named constant object.",
  );
});
