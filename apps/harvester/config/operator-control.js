/**
 * Default inbound operator-control configuration.
 * Inbound control is enabled by default; outbound Telegram notifications are configured independently.
 * Telegram credentials and environment overrides are resolved at bootstrap, not during module import.
 */
export const OPERATOR_CONTROL_CONFIG = Object.freeze({
  telegram: Object.freeze({
    enabled: true,
    allowedUserIds: Object.freeze([]),
  }),
});
