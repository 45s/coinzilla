/**
 * Default inbound operator-control configuration.
 * Inbound control is opt-in; outbound Telegram notifications are configured independently.
 * Telegram bot credentials remain environment-only; trusted user IDs come from the runtime environment.
 */
export const OPERATOR_CONTROL_CONFIG = Object.freeze({
  telegram: Object.freeze({
    enabled: false,
    allowedUserIds: Object.freeze(
      process.env.TELEGRAM_USER_ID ? [process.env.TELEGRAM_USER_ID] : [],
    ),
  }),
});
