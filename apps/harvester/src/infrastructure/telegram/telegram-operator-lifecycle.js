const TELEGRAM_COMMANDS = [
  { command: "start", description: "Open the Harvester Command Center" },
  { command: "menu", description: "Restore the persistent Command Center keyboard" },
  { command: "help", description: "Show commands and safety notes" },
  { command: "status", description: "Read runtime readiness and blockers" },
  { command: "markets", description: "Read configured market state" },
  { command: "positions", description: "Read positions and recovery accounting" },
  { command: "orders", description: "Read Harvester and external open orders" },
  { command: "balances", description: "Read latest exchange balances" },
  { command: "pause", description: "Request a market-scoped operator pause" },
  { command: "resume", description: "Request removal of an operator pause" },
  { command: "pauseallbuys", description: "Pause all BUYs and cancel Harvester-owned BUY orders" },
  { command: "resumeallbuys", description: "Resume BUYs globally" },
  { command: "pausebuys", description: "Pause BUYs for one market" },
  { command: "resumebuys", description: "Resume BUYs for one market" },
]

async function registerTelegramCommandMenu({ callApi, signal, logger, diagnostics }) {
  try {
    await callApi({ method: "setMyCommands", payload: { commands: TELEGRAM_COMMANDS }, signal })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    logger?.warn?.({
      message: "Telegram command menu registration failed; text commands remain available",
      component: "harvester.operator",
      operation: "setMyCommands",
      errorDetails: diagnostics.describeError(error),
    })
  }
}

export async function startTelegramOperatorAdapter({ state, callApi, logger, diagnostics, poll }) {
  if (state.stopPromise) {
    await state.stopPromise
  }
  if (state.startPromise) {
    return state.startPromise
  }
  if (state.controller) {
    return Object.freeze({ started: true, alreadyStarted: true })
  }
  const nextController = new AbortController()
  state.controller = nextController
  state.startPromise = (async () => {
    try {
      const identity = await callApi({ method: "getMe", payload: {}, signal: nextController.signal })
      if (nextController.signal.aborted) {
        throw new Error("Telegram operator adapter startup was aborted")
      }
      if (typeof identity?.username !== "string" || identity.username.trim() === "") {
        throw new TypeError("Telegram getMe response is missing the bot username")
      }
      state.botUsername = identity.username
      await registerTelegramCommandMenu({
        callApi,
        signal: nextController.signal,
        logger,
        diagnostics,
      })
      state.pollPromise = poll({ signal: nextController.signal })
      return Object.freeze({ started: true, alreadyStarted: false })
    } catch (error) {
      nextController.abort()
      if (state.controller === nextController) {
        state.controller = undefined
      }
      throw error
    } finally {
      state.startPromise = undefined
    }
  })()
  return state.startPromise
}

export async function stopTelegramOperatorAdapter({ state, pendingConfirmations }) {
  if (state.stopPromise) {
    return state.stopPromise
  }
  if (!state.controller) {
    if (state.startPromise) {
      await state.startPromise.catch(() => {})
    }
    if (!state.controller) {
      return Object.freeze({ stopped: true, alreadyStopped: true })
    }
  }
  const activeController = state.controller
  activeController.abort()
  state.stopPromise = (async () => {
    if (state.startPromise) {
      await state.startPromise.catch(() => {})
    }
    if (state.pollPromise) {
      await state.pollPromise
    }
    if (state.controller === activeController) {
      state.controller = undefined
    }
    state.pollPromise = undefined
    pendingConfirmations.clear()
    state.botUsername = undefined
    state.offsetState.value = undefined
    return Object.freeze({ stopped: true, alreadyStopped: false })
  })()
  try {
    return await state.stopPromise
  } finally {
    state.stopPromise = undefined
  }
}