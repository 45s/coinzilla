import { TRADING_ENVIRONMENTS } from "./src/domain/trading-environment.js";

/**
 * Operator-authorized Recovery Seller markets.
 *
 * Configured entries declare a historical legacy basis and permitted sell
 * quantity; they do not prove current Spot custody or available inventory.
 */
export const recoverySellerPairs = {
  LINEAUSDT: {
    enabled: true,
    tradingEnvironment: TRADING_ENVIRONMENTS.TESTNET,
    enableVolatilityProtection: false,
    legacyPosition: {
      invested: 400,
      quantity: 25000,
    },
    sellQuantity: 10,
    investment: 100,
    orderQuantity: 7000,
    minProfit: 0.01,
    priceStepPercent: 0.5,
    makerPercent: 0.1,
    takerPercent: 0.1,
  },
  ARBUSDT: {
    enabled: true,
    tradingEnvironment: TRADING_ENVIRONMENTS.TESTNET,
    enableVolatilityProtection: false,
    legacyPosition: {
      invested: 231,
      quantity: 400,
    },
    sellQuantity: 1,
    investment: 100,
    orderQuantity: 100,
    minProfit: 0.01,
    priceStepPercent: 0.3,
    makerPercent: 0.1,
    takerPercent: 0.1,
  },
};
