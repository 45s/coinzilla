/**
 * Default inbound operator-control configuration.
 * Inbound control is enabled by default; outbound Telegram notifications are configured independently.
 * Telegram bot credentials remain environment-only; trusted user IDs come from the runtime environment.
 */
export const OPERATOR_CONTROL_CONFIG = Object.freeze({
  telegram: Object.freeze({
    enabled: true,
    allowedUserIds: Object.freeze(
      process.env.TELEGRAM_USER_ID ? [process.env.TELEGRAM_USER_ID] : [],
    ),
  }),
});
