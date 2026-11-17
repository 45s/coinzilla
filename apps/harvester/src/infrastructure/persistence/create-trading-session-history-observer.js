import { assertTradingSessionRepository } from "../../application/ports/trading-session-repository.js"
import { createTradingSession } from "../../use-cases/create-trading-session.js"
import { transitionTradingSession } from "../../use-cases/transition-trading-session.js"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"

function reportFailure({ logger, stage, error }) {
  const entry = {
    message: "Ordinary trading-session history observer failed",
    persistenceStage: stage,
    errorName: typeof error?.name === "string" ? error.name : "Error",
    errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
  }
  try {
    logger?.error?.(entry)
  } catch {
    // Historical reporting must never affect the EventBus or trading lifecycle.
  }
  const safeError = new Error(`Trading-session history failed during ${stage}`)
  safeError.code = entry.errorCode
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
        operation: () => createSession({
          configuration: event.data,
        }),
      })
      return
    }
    if (event.name === HARVESTER_EVENT_NAMES.STARTED) {
      enqueue({
        stage: "transition-running",
        operation: () => transitionSession({
          status: "RUNNING",
          event,
        }),
      })
      return
    }
    if (event.name === HARVESTER_EVENT_NAMES.STARTUP_FAILED) {
      enqueue({
        stage: "transition-startup-failed",
        operation: () => transitionSession({
          status: "STARTUP_FAILED",
          event,
        }),
      })
      return
    }
    if (
      event.name === HARVESTER_EVENT_NAMES.STOPPED &&
      event.data.outcome === "success"
    ) {
      enqueue({
        stage: "transition-stopped",
        operation: () => transitionSession({
          status: "STOPPED",
          event,
        }),
      })
    }
  }
}

function createObserverQueue({ logger }) {
  let queue = Promise.resolve()
  const errors = []

  function enqueue({ stage, operation }) {
    queue = queue.then(operation).catch((error) => {
      errors.push(reportFailure({
        logger,
        stage,
        error,
      }))
    })
  }

  async function flush() {
    await queue
    return {
      ok: errors.length === 0,
      errors: [...errors],
    }
  }

  return {
    enqueue,
    flush,
  }
}

function createSessionOperations({ repository, processIdentity, runtimeConfig }) {
  let sessionCreated = false

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
      ...(status === "RUNNING" ? {} : {
        endedAt: event.timestamp,
      }),
    })
  }

  return {
    createSession,
    transitionSession,
  }
}

function createObserverHandle({ subscription, flush }) {
  let closed = false

  async function close() {
    if (!closed) {
      closed = true
      subscription.unsubscribe()
    }
    return flush()
  }

  return Object.freeze({
    flush,
    close,
  })
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

  const queue = createObserverQueue({ logger })
  const operations = createSessionOperations({
    repository,
    processIdentity,
    runtimeConfig,
  })
  const subscriptionResult = eventBus.subscribeAll({
    handler: createEventHandler({
      enqueue: queue.enqueue,
      createSession: operations.createSession,
      transitionSession: operations.transitionSession,
    }),
  })
  if (
    subscriptionResult?.ok !== true ||
    typeof subscriptionResult.subscription?.unsubscribe !== "function"
  ) {
    throw new Error("Unable to subscribe the trading-session history observer to lifecycle events")
  }
  return createObserverHandle({
    subscription: subscriptionResult.subscription,
    flush: queue.flush,
  })
}
