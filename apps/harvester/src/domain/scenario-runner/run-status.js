export const SCENARIO_RUN_STATUS = Object.freeze({
  ACCEPTED: "Accepted",
  QUEUED: "Queued",
  STARTING: "Starting",
  RUNNING: "Running",
  CANCELLING: "Cancelling",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  TIMED_OUT: "Timed out",
  BLOCKED: "Blocked",
})

export const TERMINAL_SCENARIO_RUN_STATUSES = Object.freeze([
  SCENARIO_RUN_STATUS.COMPLETED,
  SCENARIO_RUN_STATUS.FAILED,
  SCENARIO_RUN_STATUS.CANCELLED,
  SCENARIO_RUN_STATUS.TIMED_OUT,
  SCENARIO_RUN_STATUS.BLOCKED,
])
