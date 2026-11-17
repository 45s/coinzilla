import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.js";
import { OPERATOR_CONTROL_CONFIG } from "./operator-control.js";
import { CG_COIN_GRABBER_CONFIG } from "./strategies/cg-coin-grabber.js";

export const appConfig = {
  brokers: {
    instances: {
      binancePrimary: { provider: "binance", accountId: "binance-primary" },
    },
    selection: {
      execution: "binancePrimary",
      account: "binancePrimary",
      marketData: "binancePrimary",
    },
  },
  notifications: {
    telegram: {
      enabled: true,
      profile: NOTIFICATIONS_TG_PROFILES.TRADER,
      markets: [],
      events: {},
    },
  },
  operatorControl: OPERATOR_CONTROL_CONFIG,
  strategies: {
    CG_coinGrabber: CG_COIN_GRABBER_CONFIG,
  },
};
