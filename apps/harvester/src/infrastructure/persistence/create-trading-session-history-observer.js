import { assertTradingSessionRepository } from "../../application/ports/trading-session-repository.js"
import { createTradingSession } from "../../use-cases/create-trading-session.js"
import { transitionTradingSession } from "../../use-cases/transition-trading-session.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"

function reportFailure({ logger, stage, error }) {
  const errorName = typeof error?.name === "string" ? error.name : "Error"
  const errorCode = typeof error?.code === "string" ? error.code : "UNKNOWN"
  const entry = {
    message: "Ordinary trading-session history observer failed",
    persistenceStage: stage,
    errorName,
    errorCode,
  }
  try {
    logger?.error?.(entry)
  } catch {
    // Historical reporting must never affect the EventBus or trading lifecycle.
  }
  const safeError = new Error(`Trading-session history failed during ${stage}`)
  safeError.code = errorCode
  return safeError
}

function createSessionInput({ processIdentity, runtimeConfig, configuration }) {
  return {
    runtimeSessionId: processIdentity.runtimeSessionId,
    environment: configuration.tradingMode,
    broker: runtimeConfig.brokerName,
    strategyId: "CG_coinGrabber",
    strategyMode: configuration.strategyMode,
    configurationFingerprint: configuration.configurationFingerprint,
    enabledMarkets: configuration.enabledMarkets,
    buildProvenance: processIdentity,
    startedAt: processIdentity.startedAt,
  }
}

function createEventHandler({ enqueue, createSession, transitionSession }) {
  return (event) => {
    if (event.name === HARVESTER_EVENT_NAMES.CONFIG_VALIDATED) {
      enqueue({
        stage: "create",
        operation: () => createSession({ configuration: event.data }),
      })
      return
    }
    if (event.name === HARVESTER_EVENT_NAMES.STARTED) {
      enqueue({
        stage: "transition-running",
        operation: () => transitionSession({ status: "RUNNING", event }),
      })
      return
    }
    if (event.name === HARVESTER_EVENT_NAMES.STARTUP_FAILED) {
      enqueue({
        stage: "transition-startup-failed",
        operation: () => transitionSession({ status: "STARTUP_FAILED", event }),
      })
      return
    }
    if (
      event.name === HARVESTER_EVENT_NAMES.STOPPED &&
      event.data.outcome === "success"
    ) {
      enqueue({
        stage: "transition-stopped",
        operation: () => transitionSession({ status: "STOPPED", event }),
      })
    }
  }
}

export function createTradingSessionHistoryObserver({
  eventBus,
  repository,
  processIdentity,
  runtimeConfig,
  logger,
} = {}) {
  assertTradingSessionRepository({ repository })
  if (typeof eventBus?.subscribeAll !== "function") {
    throw new TypeError("Trading-session history observer requires an EventBus")
  }
  if (typeof processIdentity?.runtimeSessionId !== "string") {
    throw new TypeError("Trading-session history observer requires a process identity")
  }
  if (typeof runtimeConfig?.brokerName !== "string") {
    throw new TypeError("Trading-session history observer requires a validated broker identity")
  }

  let sessionCreated = false
  let closed = false
  let queue = Promise.resolve()
  const errors = []

  function enqueue({ stage, operation }) {
    queue = queue.then(operation).catch((error) => {
      errors.push(reportFailure({ logger, stage, error }))
    })
  }

  async function createSession({ configuration }) {
    await createTradingSession({
      repository,
      session: createSessionInput({
        processIdentity,
        runtimeConfig,
        configuration,
      }),
    })
    sessionCreated = true
  }

  async function transitionSession({ status, event }) {
    if (!sessionCreated) {
      return
    }
    await transitionTradingSession({
      repository,
      id: processIdentity.runtimeSessionId,
      status,
      ...(status === "RUNNING" ? {} : { endedAt: event.timestamp }),
    })
  }

  const subscriptionResult = eventBus.subscribeAll({
    handler: createEventHandler({
      enqueue,
      createSession,
      transitionSession,
    }),
  })
  if (subscriptionResult?.ok !== true || typeof subscriptionResult.subscription?.unsubscribe !== "function") {
    throw new Error("Unable to subscribe the trading-session history observer to lifecycle events")
  }

  async function flush() {
    await queue
    return {
      ok: errors.length === 0,
      errors: [...errors],
    }
  }

  async function close() {
    if (!closed) {
      closed = true
      subscriptionResult.subscription.unsubscribe()
    }
    return flush()
  }

  return Object.freeze({
    flush,
    close,
  })
}
