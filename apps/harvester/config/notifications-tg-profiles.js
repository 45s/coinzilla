/**
 * Supported Harvester-owned Telegram notification profiles.
 *
 * Keep profile identifiers stable because they are part of the application
 * configuration contract consumed by the notification policy validator.
 *
 * Profile behavior and operator configuration:
 * - [Optional Telegram notifications](../README.md#optional-telegram-notifications)
 *
 * Notification ownership, safety alerts, and delivery boundaries:
 * - [Operational notifications](../docs/architecture.md#operational-notifications)
 */
export const NOTIFICATIONS_TG_PROFILES = Object.freeze({
  MINIMAL: "minimal",
  TRADER: "trader",
  VERBOSE: "verbose",
  CUSTOM: "custom",
});
