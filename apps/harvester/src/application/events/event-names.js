/**
 * Stable Harvester-owned names for operational lifecycle events.
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
})
