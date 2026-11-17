import {
  formatTelegramOperatorMarkets,
  formatTelegramOperatorStatus,
  formatTelegramOperatorPositions,
  formatTelegramOperatorOrders,
  formatTelegramOperatorBalances,
} from "./format-telegram-operator-response.js"
import {
  createNavigationKeyboard,
  helpText,
  PAGE_METHODS,
  PAGE_TITLES,
} from "./telegram-operator-keyboard.js"

export function resolveMarketAction(page) {
  if (page === "pause") { return "PAUSE" }
  if (page === "resume") { return "RESUME" }
  return undefined
}

export function selectMarketsForAction({ markets, action }) {
  if (action === "PAUSE") {
    return markets.filter((market) => market?.enabled === true && market.operatorPaused !== true)
  }
  if (action === "RESUME") {
    return markets.filter((market) => market?.enabled === true && market.operatorPaused === true)
  }
  return []
}

export function formatMarketActionPrompt({ action, eligibleMarkets, text }) {
  const prompt = action === "PAUSE"
    ? "Choose an enabled market to pause."
    : "Choose an enabled market to resume."
  if (eligibleMarkets.length > 0) { return `${prompt}\n\n${text}` }
  const emptyMessage = action === "PAUSE"
    ? "No enabled markets are currently available to pause."
    : "No enabled operator-paused markets are currently available to resume."
  return `${prompt}\n${emptyMessage}\n\n${text}`
}


export async function readTelegramOperatorPage({ page, userId, interaction, operator, diagnostics, logStage, buildNavigationKeyboard }) {
    if (page === "home") { return { text: helpText(),
keyboard: buildNavigationKeyboard() } }
    const marketAction = resolveMarketAction(page)
    const queryPage = marketAction ? "markets" : page
    const method = PAGE_METHODS[queryPage]
    if (!method || typeof operator[method] !== "function") {
      diagnostics.report({
        interaction,
        stage: "QUERY_CONFIGURATION",
        operation: method ?? queryPage,
        classification: "OPERATOR_QUERY_UNAVAILABLE",
        message: `Read-only operator query is not available: ${queryPage}`,
      })
      return { text: "This read-only query is not available in the current operator configuration.",
keyboard: buildNavigationKeyboard({ page: queryPage }) }
    }
    interaction.operation = method
    const startedAt = Date.now()
    logStage({
      interaction,
      message: "Telegram query STARTED",
      stage: "QUERY_STARTED",
      fields: { queryPage },
    })
    let result
    try {
      result = await operator[method]({
        actor: {
          id: `telegram-user:${userId}`,
          roles: ["trading-operator"],
        },
      })
    } catch (error) {
      diagnostics.fail({
        interaction,
        error,
        stage: "QUERY_EXECUTION",
        operation: method,
      })
      return {
        text: `Unable to read the Harvester ${PAGE_TITLES[queryPage]}. No trading state was changed; check Harvester diagnostics.`,
        keyboard: buildNavigationKeyboard({ page: queryPage }),
      }
    }
    if (result?.ok !== true) {
      const queryError = result?.errors?.[0] ?? result?.error
      if (queryError !== undefined) {
        diagnostics.fail({
          interaction,
          error: queryError,
          stage: "QUERY_RESULT",
          operation: method,
        })
      } else {
        diagnostics.report({
          interaction,
          stage: "QUERY_RESULT",
          operation: method,
          classification: "OPERATOR_QUERY_FAILED",
          message: `Operator read query returned ok:false without error details: ${method}`,
        })
      }
      return {
        text: `Unable to read the Harvester ${PAGE_TITLES[queryPage]}. No trading state was changed; check Harvester diagnostics.`,
        keyboard: buildNavigationKeyboard({ page: queryPage }),
      }
    }
    logStage({
      interaction,
      message: "Telegram query COMPLETED",
      stage: "QUERY_COMPLETED",
      fields: { durationMs: Date.now() - startedAt },
    })
    interaction.stage = "QUERY_FORMATTING"
    const text = ({
      status: () => formatTelegramOperatorStatus({ status: result.data }),
      markets: () => formatTelegramOperatorMarkets({ snapshot: result.data }),
      positions: () => formatTelegramOperatorPositions({ snapshot: result.data }),
      orders: () => formatTelegramOperatorOrders({ snapshot: result.data }),
      balances: () => formatTelegramOperatorBalances({ snapshot: result.data }),
    })[queryPage]()
    const markets = queryPage === "markets" ? result.data.markets : []
    const keyboard = buildNavigationKeyboard({ page: queryPage,
markets,
marketAction })
    if (!marketAction) { return { text,
keyboard } }
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
