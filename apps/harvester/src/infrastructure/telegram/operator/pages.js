import {
  formatTelegramOperatorMarkets,
  formatTelegramOperatorStatus,
  formatTelegramOperatorPositions,
  formatTelegramOperatorOrders,
  formatTelegramOperatorBalances,
} from "./format-response.js"
import {
  TELEGRAM_OPERATOR_ACTIONS,
  TELEGRAM_OPERATOR_QUERY_STAGES,
} from "./constants.js"
import { OPERATOR_ACTOR_ROLES } from "../../../application/operator/constants.js"
import {
  helpText,
  PAGE_METHODS,
  PAGE_TITLES,
} from "./keyboard.js"

export function resolveMarketAction(page) {
  if (page === "pause") { return TELEGRAM_OPERATOR_ACTIONS.PAUSE }
  if (page === "resume") { return TELEGRAM_OPERATOR_ACTIONS.RESUME }
  return undefined
}

function isMarketBuyPaused(market) {
  return typeof market?.operatorBuysPaused === "boolean"
    ? market.operatorBuysPaused
    : market?.operatorPaused === true
}

export function selectMarketsForAction({ markets,
 action }) {
  if (action === TELEGRAM_OPERATOR_ACTIONS.PAUSE) {
    return markets.filter((market) => market?.enabled === true && !isMarketBuyPaused(market))
  }
  if (action === TELEGRAM_OPERATOR_ACTIONS.RESUME) {
    return markets.filter((market) => market?.enabled === true && isMarketBuyPaused(market))
  }
  return []
}

export function formatMarketActionPrompt({ action,
 eligibleMarkets,
 text }) {
  const prompt = action === TELEGRAM_OPERATOR_ACTIONS.PAUSE
    ? "Choose an enabled market to pause."
    : "Choose an enabled market to resume."
  if (eligibleMarkets.length > 0) { return `${prompt}\n\n${text}` }
  const emptyMessage = action === TELEGRAM_OPERATOR_ACTIONS.PAUSE
    ? "No enabled markets are currently available to pause."
    : "No enabled BUY-paused markets are currently available to resume."
  return `${prompt}\n${emptyMessage}\n\n${text}`
}


function createUnavailablePage({ queryPage,
 method,
 diagnostics,
 interaction,
 buildNavigationKeyboard }) {
  diagnostics.report({
    interaction,
    stage: "QUERY_CONFIGURATION",
    operation: method ?? queryPage,
    classification: "OPERATOR_QUERY_UNAVAILABLE",
    message: `Read-only operator query is not available: ${queryPage}`,
  })
  return {
    text: "This read-only query is not available in the current operator configuration.",
    keyboard: buildNavigationKeyboard({ page: queryPage }),
  }
}

async function executeOperatorQuery({ method, userId, operator, diagnostics, interaction }) {
  try {
    return {
      result: await operator[method]({
        actor: {
          id: `telegram-user:${userId}`,
          roles: [OPERATOR_ACTOR_ROLES.TRADING_OPERATOR],
        },
      }),
    }
  } catch (error) {
    diagnostics.fail({
      interaction,
      error,
      stage: TELEGRAM_OPERATOR_QUERY_STAGES.EXECUTION,
      operation: method,
    })
    return { threw: true }
  }
}

function logOperatorQueryStarted({ interaction, queryPage, logStage }) {
  logStage({
    interaction,
    message: "Telegram query STARTED",
    stage: TELEGRAM_OPERATOR_QUERY_STAGES.STARTED,
    fields: { queryPage },
  })
}

function logOperatorQueryCompleted({ interaction, startedAt, logStage }) {
  logStage({
    interaction,
    message: "Telegram query COMPLETED",
    stage: TELEGRAM_OPERATOR_QUERY_STAGES.COMPLETED,
    fields: { durationMs: Date.now() - startedAt },
  })
}

function createQueryFailureOutcome({
  outcome,
  queryPage,
  method,
  diagnostics,
  interaction,
  buildNavigationKeyboard,
}) {
  if (outcome.threw) {
    return {
      ok: false,
      page: createQueryFailurePage({
        queryPage,
        buildNavigationKeyboard,
      }),
    }
  }
  if (outcome.result?.ok === true) { return undefined }
  reportQueryResultFailure({
    result: outcome.result,
    method,
    diagnostics,
    interaction,
  })
  return {
    ok: false,
    page: createQueryFailurePage({
      queryPage,
      buildNavigationKeyboard,
    }),
  }
}

async function readOperatorQuery({
  queryPage,
  userId,
  interaction,
  operator,
  diagnostics,
  logStage,
  buildNavigationKeyboard,
}) {
  const method = PAGE_METHODS[queryPage]
  if (!method || typeof operator[method] !== "function") {
    return {
      ok: false,
      page: createUnavailablePage({
        queryPage,
        method,
        diagnostics,
        interaction,
        buildNavigationKeyboard,
      }),
    }
  }
  interaction.operation = method
  const startedAt = Date.now()
  logOperatorQueryStarted({
    interaction,
    queryPage,
    logStage,
  })
  const outcome = await executeOperatorQuery({
    method,
    userId,
    operator,
    diagnostics,
    interaction,
  })
  const failure = createQueryFailureOutcome({
    outcome,
    queryPage,
    method,
    diagnostics,
    interaction,
    buildNavigationKeyboard,
  })
  if (failure) { return failure }
  logOperatorQueryCompleted({
    interaction,
    startedAt,
    logStage,
  })
  return {
    ok: true,
    result: outcome.result,
  }
}

function createQueryFailurePage({ queryPage,
 buildNavigationKeyboard }) {
  return {
    text: `Unable to read the Harvester ${PAGE_TITLES[queryPage]}. No trading state was changed; check Harvester diagnostics.`,
    keyboard: buildNavigationKeyboard({ page: queryPage }),
  }
}

function reportQueryResultFailure({ result,
 method,
 diagnostics,
 interaction }) {
  const queryError = result?.errors?.[0] ?? result?.error
  if (queryError !== undefined) {
    diagnostics.fail({ interaction,
 error: queryError,
 stage: "QUERY_RESULT",
 operation: method })
    return
  }
  diagnostics.report({
    interaction,
    stage: "QUERY_RESULT",
    operation: method,
    classification: "OPERATOR_QUERY_FAILED",
    message: `Operator read query returned ok:false without error details: ${method}`,
  })
}

function formatOperatorPage({ queryPage,
 result,
 marketAction,
 interaction,
 logStage,
 buildNavigationKeyboard }) {
  interaction.stage = "QUERY_FORMATTING"
  const formatters = {
    status: () => formatTelegramOperatorStatus({ status: result.data }),
    markets: () => formatTelegramOperatorMarkets({ snapshot: result.data }),
    positions: () => formatTelegramOperatorPositions({ snapshot: result.data }),
    orders: () => formatTelegramOperatorOrders({ snapshot: result.data }),
    balances: () => formatTelegramOperatorBalances({ snapshot: result.data }),
  }
  const text = formatters[queryPage]()
  const markets = queryPage === "markets" ? result.data.markets : []
  const keyboard = buildNavigationKeyboard({ page: queryPage,
 markets,
 marketAction })
  if (!marketAction) {
    return { text,
 keyboard }
  }
  const eligibleMarkets = selectMarketsForAction({ markets,
 action: marketAction })
  logStage({
    interaction,
    message: "Telegram market selection READY",
    stage: "MARKET_SELECTION_READY",
    fields: { eligibleMarketCount: eligibleMarkets.length },
  })
  return {
    text: formatMarketActionPrompt({ action: marketAction,
 eligibleMarkets,
 text }),
    keyboard,
  }
}

export async function readTelegramOperatorPage(options) {
  const { page, userId, interaction, operator, diagnostics, logStage, buildNavigationKeyboard } = options
  if (page === "home") {
    return { text: helpText(),
 keyboard: buildNavigationKeyboard() }
  }
  const marketAction = resolveMarketAction(page)
  const queryPage = marketAction ? "markets" : page
  const outcome = await readOperatorQuery({
    queryPage,
    userId,
    interaction,
    operator,
    diagnostics,
    logStage,
    buildNavigationKeyboard,
  })
  if (!outcome.ok) {
    return outcome.page
  }
  return formatOperatorPage({
    queryPage,
    result: outcome.result,
    marketAction,
    interaction,
    logStage,
    buildNavigationKeyboard,
  })
}