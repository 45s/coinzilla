import { TELEGRAM_OPERATOR_ACTIONS } from "./constants.js"
import { OPERATOR_ACTOR_ROLES } from "../../../application/operator/constants.js"

function recordControlFailure({ result, method, symbol, interaction, diagnostics }) {
  if (interaction.failed) { return }
  const controlError = result?.errors?.[0] ?? result?.error
  if (controlError !== undefined) {
    diagnostics.fail({
      interaction,
      error: controlError,
      stage: "APPLICATION_OPERATION_RESULT",
      operation: method,
      symbol,
    })
    return
  }
  diagnostics.report({
    interaction,
    stage: "APPLICATION_OPERATION_RESULT",
    operation: method,
    symbol,
    classification: "APPLICATION_OPERATION_REJECTED",
    message: `Operator control use case returned ok:false without error details: ${method}`,
  })
}

function buildControlFailureMessage({ code, action, symbol, interaction }) {
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
  return `${action.startsWith(TELEGRAM_OPERATOR_ACTIONS.RESUME) ? "Resume" : "Pause"} was not acknowledged; check Harvester logs and retry.`
}

export function buildControlFailureReply(options) {
  recordControlFailure(options)
  const code = options.result?.errors?.[0]?.code ?? options.result?.error?.code
  return buildControlFailureMessage({
    code,
    action: options.action,
    symbol: options.symbol,
    interaction: options.interaction,
  })
}

export function buildPauseBuySuccessReply({ buyScope,
 symbol,
 result,
 interaction }) {
  if (result.data?.paused !== true) {
    return undefined
  }
  interaction.applicationOperationCompleted = true
  interaction.stateChanged = result.data.alreadyPaused !== true || result.data.canceled > 0
  let prefix
  if (result.data.alreadyPaused === true) {
    prefix = `BUY pause remains active ${buyScope}`
  } else if (symbol) {
    prefix = `Paused ${symbol}: BUY pause activated`
  } else {
    prefix = "BUY pause activated across all markets"
  }
  return `${prefix}. Cancelled ${result.data.canceled ?? 0} Harvester-owned BUY order(s); reconciled ${result.data.reconciled ?? 0} fill(s). Recovery SELLs and accounting continue. External/manual and prior-process orders are untouched. Existing exchange orders remain open and may still fill if they are not current-process-owned BUYs; check /orders. This pause is process-local and is not restored after restart.`
}

export function buildResumeBuySuccessReply({ buyScope,
 symbol,
 result,
 interaction }) {
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
    const inactiveMessage = symbol
      ? `${symbol} is not operator-paused for BUYs. No state change was made.`
      : "No global BUY pause was active. No state change was made."
    return `${inactiveMessage}${remaining}`
  }
  return undefined
}

export function buildBuyControlSuccessReply({ action,
 symbol,
 result,
 interaction } = {}) {
  const buyScope = symbol ? `for ${symbol}` : "across all markets"
  if (action === TELEGRAM_OPERATOR_ACTIONS.PAUSE || action === TELEGRAM_OPERATOR_ACTIONS.PAUSE_BUYS || action === TELEGRAM_OPERATOR_ACTIONS.PAUSE_ALL_BUYS) {
    return buildPauseBuySuccessReply({
      buyScope,
      symbol,
      result,
      interaction,
    })
  }
  if (action === TELEGRAM_OPERATOR_ACTIONS.RESUME || action === TELEGRAM_OPERATOR_ACTIONS.RESUME_BUYS || action === TELEGRAM_OPERATOR_ACTIONS.RESUME_ALL_BUYS) {
    return buildResumeBuySuccessReply({
      buyScope,
      symbol,
      result,
      interaction,
    })
  }
  return undefined
}

export function buildLegacyControlSuccessReply({ action,
 symbol,
 method,
 interaction,
 diagnostics }) {
  diagnostics.report({
    interaction,
    stage: "APPLICATION_OPERATION_RESULT",
    operation: method,
    symbol,
    classification: "OPERATOR_CONTROL_RESULT_INVALID",
    message: `Operator control use case returned an invalid success result: ${method}`,
  })
  return `${action.startsWith(TELEGRAM_OPERATOR_ACTIONS.RESUME) ? "Resume" : "Pause"} was not acknowledged; check Harvester logs and retry.`
}

export function buildControlSuccessReply(options) {
  return buildBuyControlSuccessReply(options) ?? buildLegacyControlSuccessReply(options)
}

export function buildControlReply(options) {
  return options.result?.ok
    ? buildControlSuccessReply(options)
    : buildControlFailureReply(options)
}


const OPERATOR_CONTROL_METHODS = Object.freeze({
  [TELEGRAM_OPERATOR_ACTIONS.PAUSE]: "pauseMarket",
  [TELEGRAM_OPERATOR_ACTIONS.RESUME]: "resumeMarket",
  [TELEGRAM_OPERATOR_ACTIONS.PAUSE_BUYS]: "pauseBuys",
  [TELEGRAM_OPERATOR_ACTIONS.RESUME_BUYS]: "resumeBuys",
  [TELEGRAM_OPERATOR_ACTIONS.PAUSE_ALL_BUYS]: "pauseAllBuys",
  [TELEGRAM_OPERATOR_ACTIONS.RESUME_ALL_BUYS]: "resumeAllBuys",
})

function reportUnavailableOperatorControl({ action, symbol, method, interaction, diagnostics }) {
  const verb = action.startsWith(TELEGRAM_OPERATOR_ACTIONS.RESUME) ? "Resume" : "Pause"
  diagnostics.report({
    interaction,
    stage: "APPLICATION_OPERATION_UNAVAILABLE",
    operation: method,
    symbol,
    classification: "OPERATOR_CONTROL_UNAVAILABLE",
    message: `Operator control use case is unavailable: ${method}`,
  })
  return {
    method,
    reply: `${verb} is not available in this operator adapter configuration.`,
  }
}

async function callOperatorControl({ method, symbol, userId, requestId, operator, diagnostics, interaction }) {
  try {
    return await operator[method]({
      actor: {
        id: `telegram-user:${userId}`,
        roles: [OPERATOR_ACTOR_ROLES.TRADING_OPERATOR],
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
    return undefined
  }
}

function logOperatorControlCompletion({ action, interaction, startedAt, logStage }) {
  if (!interaction.applicationOperationCompleted) { return }
  logStage({
    interaction,
    message: "Telegram application operation COMPLETED",
    stage: "APPLICATION_OPERATION_COMPLETED",
    level: "info",
    fields: {
      durationMs: Date.now() - startedAt,
      result: action.startsWith(TELEGRAM_OPERATOR_ACTIONS.PAUSE) ? "PAUSED" : "RESUME_PROCESSED",
    },
  })
}

async function invokeOperatorControl(options) {
  const {
    action,
    symbol,
    userId,
    requestId,
    interaction,
    operator,
    diagnostics,
    logStage,
  } = options
  const method = OPERATOR_CONTROL_METHODS[action]
  interaction.action = action
  interaction.symbol = symbol
  interaction.operation = method
  if (typeof operator[method] !== "function") {
    return reportUnavailableOperatorControl({
      action,
      symbol,
      method,
      interaction,
      diagnostics,
    })
  }
  const startedAt = Date.now()
  interaction.applicationOperationInvoked = true
  logStage({
    interaction,
    message: "Telegram application operation STARTED",
    stage: "APPLICATION_OPERATION_STARTED",
  })
  const result = await callOperatorControl({
    method,
    symbol,
    userId,
    requestId,
    operator,
    diagnostics,
    interaction,
  })
  const reply = buildControlReply({
    action,
    symbol,
    result,
    method,
    interaction,
    diagnostics,
  })
  logOperatorControlCompletion({
    action,
    interaction,
    startedAt,
    logStage,
  })
  return {
    method,
    reply,
  }
}

export async function executeTelegramOperatorControl({
  action,
  symbol,
  userId,
  requestId,
  chatId,
  messageId,
  signal,
  interaction,
  operator,
  diagnostics,
  logStage,
  sendMessage,
  editMessage,
  buildNavigationKeyboard,
}) {
  const result = await invokeOperatorControl({
    action,
    symbol,
    userId,
    requestId,
    interaction,
    operator,
    diagnostics,
    logStage,
  })
  const response = {
    chatId,
    text: result.reply,
    replyMarkup: buildNavigationKeyboard(),
    signal,
    interaction,
  }
  if (messageId !== undefined) {
    await editMessage({ ...response,
 messageId })
    return
  }
  await sendMessage(response)
}