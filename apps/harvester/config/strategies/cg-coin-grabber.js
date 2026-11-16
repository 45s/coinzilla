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
      // Process-restart restoration is deferred; prior process history keeps trading off while CC can start.
      enabled: false,
    },
  },
  pairs: tradingPairs,
};
