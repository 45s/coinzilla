import { TRADING_ENVIRONMENTS } from "./src/domain/trading-environment.js";

const commonRecoverySellerFields = {
  enabled: true,
  tradingEnvironment: TRADING_ENVIRONMENTS.TESTNET,
  enableVolatilityProtection: false,
  minProfit: 0.01,
  makerPercent: 0.1,
  takerPercent: 0.1,
};

/**
 * Operator-authorized Recovery Seller markets.
 *
 * Configured entries declare a historical legacy basis and permitted sell
 * quantity; they do not prove current Spot custody or available inventory.
 */
export const recoverySellerPairs = {
  LINEAUSDT: {
    ...commonRecoverySellerFields,
    legacyPosition: {
      invested: 400,
      quantity: 25000,
    },
    sellQuantity: 10,
    investment: 100,
    orderQuantity: 7000,
    priceStepPercent: 0.5,
  },
  ARBUSDT: {
    ...commonRecoverySellerFields,
    legacyPosition: {
      invested: 231,
      quantity: 400,
    },
    sellQuantity: 1,
    investment: 100,
    orderQuantity: 100,
    priceStepPercent: 0.3,
  },
};
