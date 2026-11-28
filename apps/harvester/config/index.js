import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.js";
import { OPERATOR_CONTROL_CONFIG } from "./operator-control.js";
import { CG_COIN_GRABBER_CONFIG } from "./strategies/cg-coin-grabber.js";
import { RS_RECOVERY_SELLER_CONFIG } from "./strategies/rs-recovery-seller.js";
import { StrategyId } from "../src/domain/strategies/strategy-ids.js";

export const appConfig = {
  components: {
    tradingHistoryApi: {
      enabled: true,
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
    [StrategyId.COIN_GRABBER]: CG_COIN_GRABBER_CONFIG,
    [StrategyId.RECOVERY_SELLER]: RS_RECOVERY_SELLER_CONFIG,
  },
};
