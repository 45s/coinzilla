function assertRuntime(runtime) {
  if (
    runtime === null ||
    typeof runtime !== "object" ||
    !runtime.eventBus ||
    !runtime.journal
  ) {
    throw new TypeError("A valid Coin Farmer runtime is required")
  }
}

function assertResult(result, operation) {
  if (!result?.ok) {
    throw new Error(`Coin Farmer ${operation} failed`, {
      cause: result?.errors ?? result?.error,
    })
  }
}

async function closeAfterStartupFailure(runtime, startupError) {
  const cleanupErrors = []

  for (const [name, resource] of [
    ["journal", runtime.journal],
    ["event bus", runtime.eventBus],
  ]) {
    try {
      const result = await resource.close()
      assertResult(result, `${name} cleanup`)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  runtime.state = "failed"

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [startupError, ...cleanupErrors],
      "Coin Farmer startup failed and cleanup was incomplete",
      { cause: startupError },
    )
  }

  throw startupError
}

export async function startRuntime(runtime) {
  assertRuntime(runtime)

  if (runtime.state === "started") {
    return runtime
  }

  if (runtime.state !== "created") {
    throw new Error(`Cannot start runtime from state: ${runtime.state}`)
  }

  try {
    const journalResult = await runtime.journal.start()
    assertResult(journalResult, "journal startup")

    runtime.state = "started"

    const publishResult = runtime.eventBus.publish({
      name: "runtime.started",
      source: "bot-coin-farmer",
      data: {
        tradingEnabled: false,
        environment: runtime.config.application.environment,
      },
    })
    assertResult(publishResult, "startup event publication")

    runtime.logger.info({
      message: "Coin Farmer runtime started in no-trading mode",
      environment: runtime.config.application.environment,
    })

    return runtime
  } catch (error) {
    return closeAfterStartupFailure(runtime, error)
  }
}

export function shutdownRuntime(runtime) {
  assertRuntime(runtime)

  if (runtime.shutdownPromise) {
    return runtime.shutdownPromise
  }

  runtime.shutdownPromise = (async () => {
    if (runtime.state === "stopped") {
      return { stopped: true, errors: [] }
    }

    const wasStarted = runtime.state === "started"
    runtime.state = "stopping"
    const errors = []

    if (wasStarted) {
      try {
        const result = runtime.eventBus.publish({
          name: "runtime.stopped",
          source: "bot-coin-farmer",
          data: { tradingEnabled: false },
        })
        assertResult(result, "shutdown event publication")
      } catch (error) {
        errors.push(error)
      }
    }

    try {
      const result = await runtime.journal.close()
      assertResult(result, "journal shutdown")
    } catch (error) {
      errors.push(error)
    }

    try {
      const result = await runtime.eventBus.close({
        timeoutMs: runtime.config.runtime.shutdownTimeoutMs,
      })
      assertResult(result, "event bus shutdown")
    } catch (error) {
      errors.push(error)
    }

    runtime.state = "stopped"

    if (errors.length > 0) {
      throw new AggregateError(errors, "Coin Farmer shutdown completed with errors")
    }

    return { stopped: true, errors: [] }
  })()

  return runtime.shutdownPromise
}

export function installSignalHandlers({
  runtime,
  processObject = process,
} = {}) {
  assertRuntime(runtime)

  if (
    !processObject ||
    typeof processObject.on !== "function" ||
    (typeof processObject.off !== "function" &&
      typeof processObject.removeListener !== "function")
  ) {
    throw new TypeError("processObject must support on() and listener removal")
  }

  let handlingSignal = false

  const remove = processObject.off?.bind(processObject)
    ?? processObject.removeListener.bind(processObject)

  function removeHandlers() {
    remove("SIGINT", onSigint)
    remove("SIGTERM", onSigterm)
  }

  async function handleSignal(signal) {
    if (handlingSignal) {
      return
    }
    handlingSignal = true

    try {
      runtime.logger.info({ message: "Shutdown signal received", signal })
      await shutdownRuntime(runtime)
    } catch (error) {
      runtime.logger.error({
        message: "Coin Farmer shutdown failed",
        signal,
        error,
      })
      processObject.exitCode = 1
    } finally {
      removeHandlers()
    }
  }

  const onSigint = () => void handleSignal("SIGINT")
  const onSigterm = () => void handleSignal("SIGTERM")

  processObject.on("SIGINT", onSigint)
  processObject.on("SIGTERM", onSigterm)

  return removeHandlers
}
