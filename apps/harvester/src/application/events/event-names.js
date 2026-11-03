/**
 * Stable Harvester-owned names for operational lifecycle and strategy/order events.
 *
 * EventBus owns the envelope, generated ID, timestamp, and payload snapshot.
 */
export const HARVESTER_EVENT_SOURCE = "harvester"

export const HARVESTER_EVENT_NAMES = Object.freeze({
  STARTED: "harvester.started",
  STARTUP_FAILED: "harvester.startup_failed",
  STOPPED: "harvester.stopped",
  CONFIG_VALIDATED: "config.validated",
  BROKER_CONNECTED: "broker.connected",
  BROKER_CONNECTION_FAILED: "broker.connection_failed",
  BROKER_DISCONNECTED: "broker.disconnected",
  BROKER_STATUS_CHANGED: "broker.status_changed",
  BROKER_SUBSCRIPTION_ESTABLISHED: "broker.subscription_established",
  BROKER_SUBSCRIPTION_FAILED: "broker.subscription_failed",
  STRATEGY_DECISION: "strategy.decision",
  ORDER_SUBMISSION_REQUESTED: "order.submission_requested",
  ORDER_SUBMITTED: "order.submitted",
  ORDER_SUBMISSION_FAILED: "order.submission_failed",
  STRATEGY_PAUSED: "strategy.paused",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_CANCEL_FAILED: "order.cancel_failed",
  FILL_APPLIED: "execution.fill_applied",
  EXECUTION_UNOWNED_ORDER: "execution.unowned_order",
  EXECUTION_INVALID_FILL: "execution.invalid_fill",
  EXECUTION_ACCOUNTING_FAILED: "execution.accounting_failed",
})
