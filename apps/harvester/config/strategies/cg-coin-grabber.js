import { tradingPairs } from "../../cg-coin-grabber.js";

export const CG_COIN_GRABBER_CONFIG = {
  enabled: true,
  settings: {
    conservative: {
      enabled: true,
    },
    aggressive: {
      enabled: false,
    },
    recovery: {
      enabled: false,
    },
  },
  pairs: tradingPairs,
};
