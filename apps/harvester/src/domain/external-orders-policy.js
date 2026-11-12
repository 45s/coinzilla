/**
 * Supported per-pair policies for manual/external exchange orders.
 * Harvester-generated client IDs remain fail-closed independently of this policy.
 */
export const EXTERNAL_ORDERS_POLICIES = Object.freeze({
  IGNORE: "ignore",
  BLOCK: "block",
});
