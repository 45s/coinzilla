/**
 * Default inbound operator-control configuration.
 * Credentials remain environment-only; inbound control is disabled by default.
 */
export const OPERATOR_CONTROL_CONFIG = Object.freeze({
  telegram: Object.freeze({
    enabled: false,
    allowedUserIds: Object.freeze([]),
  }),
});
