export function buildControlFailureReply({ action, symbol, result, method, interaction, diagnostics }) {
  if (!interaction.failed) {
    const controlError = result?.errors?.[0] ?? result?.error
    if (controlError !== undefined) {
      diagnostics.fail({
        interaction,
        error: controlError,
        stage: "APPLICATION_OPERATION_RESULT",
        operation: method,
        symbol,
      })
    } else {
      diagnostics.report({
        interaction,
        stage: "APPLICATION_OPERATION_RESULT",
        operation: method,
        symbol,
        classification: "APPLICATION_OPERATION_REJECTED",
        message: `Operator control use case returned ok:false without error details: ${method}`,
      })
    }
  }
  const code = result?.errors?.[0]?.code ?? result?.error?.code
  if (code === "INVALID_OPERATOR_MARKET") {
    return `Unknown configured market: ${symbol}.`
  }
  if (code === "SAFETY_BLOCKER_ACTIVE") {
    return `Cannot resume ${symbol}: a safety, recovery, or volatility blocker is still active. The blocker was not changed.`
  }
  if (code === "OPERATOR_BUY_CANCELLATION_INCOMPLETE") {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = true
    const scope = symbol ? `for ${symbol}` : "across all markets"
    return `BUY pause is active ${scope}, but cancellation of one or more Harvester-owned BUY orders is unresolved. New BUY submissions remain blocked. Check /orders and Harvester diagnostics before assuming the market is clear.`
  }
  if (code === "INVALID_OPERATOR_SCOPE") {
    return "Global BUY commands do not accept a market symbol."
  }
  return `${action.startsWith("RESUME") ? "Resume" : "Pause"} was not acknowledged; check Harvester logs and retry.`
}

export function buildPauseBuySuccessReply({ buyScope, result, interaction }) {
  if (result.data?.paused !== true) {
    return undefined
  }
  interaction.applicationOperationCompleted = true
  interaction.stateChanged = result.data.alreadyPaused !== true || result.data.canceled > 0
  const prefix = result.data.alreadyPaused === true ? "BUY pause remains active" : "BUY pause activated"
  return `${prefix} ${buyScope}. Cancelled ${result.data.canceled ?? 0} Harvester-owned BUY order(s); reconciled ${result.data.reconciled ?? 0} fill(s). Recovery SELLs and accounting continue. External/manual and prior-process orders are untouched; check /orders. This pause is process-local and is not restored after restart.`
}

export function buildResumeBuySuccessReply({ buyScope, result, interaction }) {
  if (result.data?.resumed === true) {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = true
    const remaining = result.data.stillPaused === true
      ? " Another BUY pause scope is still active."
      : " New BUYs may resume when all other safety gates allow."
    return `BUY pause removed ${buyScope}.${remaining}`
  }
  if (result.data?.resumed === false) {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = false
    const remaining = result.data.stillPaused === true
      ? " Another BUY pause scope remains active."
      : ""
    return `No BUY pause was active ${buyScope}.${remaining}`
  }
  return undefined
}

export function buildBuyControlSuccessReply({ action, symbol, result, interaction } = {}) {
  const buyScope = symbol ? `for ${symbol}` : "across all markets"
  if (action === "PAUSE_BUYS" || action === "PAUSE_ALL_BUYS") {
    return buildPauseBuySuccessReply({
      buyScope,
      result,
      interaction,
    })
  }
  if (action === "RESUME_BUYS" || action === "RESUME_ALL_BUYS") {
    return buildResumeBuySuccessReply({
      buyScope,
      result,
      interaction,
    })
  }
  return undefined
}

export function buildLegacyControlSuccessReply({ action, symbol, result, method, interaction, diagnostics }) {
  if (action === "RESUME" && result.data?.resumed === true) {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = true
    return `Resumed ${symbol}: the operator-owned pause was removed. Safety, recovery, and volatility controls remain in force.`
  }
  if (action === "RESUME" && result.data?.resumed === false) {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = false
    return `${symbol} is not operator-paused. No state change was made.`
  }
  if (action === "PAUSE" && result.data?.paused === true) {
    interaction.applicationOperationCompleted = true
    interaction.stateChanged = result.data.alreadyPaused !== true
    if (result.data.alreadyPaused === true) {
      return `Already paused ${symbol}. New strategy BUYs remain blocked.`
    }
    return `Paused ${symbol}: new strategy BUYs and trailing-BUY replacements are blocked. Existing exchange orders remain open and may still fill. This pause is process-local and is not restored after restart.`
  }
  diagnostics.report({
    interaction,
    stage: "APPLICATION_OPERATION_RESULT",
    operation: method,
    symbol,
    classification: "OPERATOR_CONTROL_RESULT_INVALID",
    message: `Operator control use case returned an invalid success result: ${method}`,
  })
  return `${action === "RESUME" ? "Resume" : "Pause"} was not acknowledged; check Harvester logs and retry.`
}

export function buildControlSuccessReply(options) {
  return buildBuyControlSuccessReply(options) ?? buildLegacyControlSuccessReply(options)
}

export function buildControlReply(options) {
  return options.result?.ok
    ? buildControlSuccessReply(options)
    : buildControlFailureReply(options)
}


export async function executeTelegramOperatorControl({ action, symbol, userId, requestId, chatId, messageId, signal, interaction, operator, diagnostics, logStage, sendMessage, editMessage, buildNavigationKeyboard }) {
    const method = ({
      PAUSE: "pauseMarket",
      RESUME: "resumeMarket",
      PAUSE_BUYS: "pauseBuys",
      RESUME_BUYS: "resumeBuys",
      PAUSE_ALL_BUYS: "pauseAllBuys",
      RESUME_ALL_BUYS: "resumeAllBuys",
    })[action]
    interaction.action = action
    interaction.symbol = symbol
    interaction.operation = method
    if (typeof operator[method] !== "function") {
      const text = action.startsWith("RESUME") ? "Resume is not available in this operator adapter configuration." : "Pause is not available in this operator adapter configuration."
      diagnostics.report({
        interaction,
        stage: "APPLICATION_OPERATION_UNAVAILABLE",
        operation: method,
        symbol,
        classification: "OPERATOR_CONTROL_UNAVAILABLE",
        message: `Operator control use case is unavailable: ${method}`,
      })
      if (messageId !== undefined) { await editMessage({ chatId,
messageId,
text,
replyMarkup: buildNavigationKeyboard(),
signal,
interaction }) }
      else { await sendMessage({ chatId,
text,
replyMarkup: buildNavigationKeyboard(),
signal,
interaction }) }
      return
    }
    const startedAt = Date.now()
    interaction.applicationOperationInvoked = true
    logStage({
      interaction,
      message: "Telegram application operation STARTED",
      stage: "APPLICATION_OPERATION_STARTED",
    })
    let result
    try {
      result = await operator[method]({
        actor: {
          id: `telegram-user:${userId}`,
          roles: ["trading-operator"],
        },
        requestId,
        symbol,
      })
    } catch (error) {
      diagnostics.fail({
        interaction,
        error,
        stage: "APPLICATION_OPERATION",
        operation: method,
        symbol,
      })
    }
    const reply = buildControlReply({
      action,
      symbol,
      result,
      method,
      interaction,
      diagnostics,
    })
    if (interaction.applicationOperationCompleted) {
      logStage({
        interaction,
        message: "Telegram application operation COMPLETED",
        stage: "APPLICATION_OPERATION_COMPLETED",
        level: "info",
        fields: {
          durationMs: Date.now() - startedAt,
          result: action.startsWith("PAUSE") ? "PAUSED" : "RESUME_PROCESSED",
        },
      })
    }
    if (messageId !== undefined) {
      await editMessage({
        chatId,
        messageId,
        text: reply,
        replyMarkup: buildNavigationKeyboard(),
        signal,
        interaction,
      })
    } else {
      await sendMessage({
        chatId,
        text: reply,
        replyMarkup: buildNavigationKeyboard(),
        signal,
        interaction,
      })
    }
}
