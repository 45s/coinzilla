/**
 * Supported Harvester-owned Telegram notification profiles.
 *
 * Keep profile identifiers stable because they are part of the application
 * configuration contract consumed by the notification policy validator.
 */
export const NOTIFICATIONS_TG_PROFILES = Object.freeze({
  MINIMAL: "minimal",
  TRADER: "trader",
  VERBOSE: "verbose",
  CUSTOM: "custom",
});
