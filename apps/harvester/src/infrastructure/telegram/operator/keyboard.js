function isMarketBuyPaused(market) {
  return typeof market?.operatorBuysPaused === "boolean"
    ? market.operatorBuysPaused
    : market?.operatorPaused === true
}

export function createNavigationKeyboard({ page = "home", markets = [], marketAction } = {}) {
  const rows = [
    [{ text: "Status",
callback_data: "cc:nav:status" }, { text: "Markets",
callback_data: "cc:nav:markets" }],
    [{ text: "Positions",
callback_data: "cc:nav:positions" }, { text: "Orders",
callback_data: "cc:nav:orders" }],
    [{ text: "Balances",
callback_data: "cc:nav:balances" }],
  ]
  if (page === "markets") {
    let actionCount = 0
    for (const market of markets) {
      if (actionCount >= 20) { break }
      if (typeof market?.symbol !== "string" || !/^[A-Z0-9]{2,30}$/.test(market.symbol) || market.enabled !== true) { continue }
      if (marketAction === "PAUSE" && isMarketBuyPaused(market)) { continue }
      if (marketAction === "RESUME" && !isMarketBuyPaused(market)) { continue }
      const action = isMarketBuyPaused(market) ? "RESUME" : "PAUSE"
      rows.push([{
        text: `${action === "PAUSE" ? "Pause" : "Resume"} ${market.symbol}`,
        callback_data: `cc:ask:${action}:${market.symbol}`,
      }])
      actionCount += 1
    }
  }
  const refreshPage = marketAction ? marketAction.toLowerCase() : page
  rows.push([{
    text: "Refresh",
    callback_data: `cc:refresh:${refreshPage}`,
  }, {
    text: "Main menu",
    callback_data: "cc:nav:home",
  }])
  return { inline_keyboard: rows }
}

export function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "Pause" }, { text: "Resume" }],
      [{ text: "Status" }, { text: "Markets" }],
      [{ text: "Portfolio" }, { text: "Open Orders" }],
    ],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Command Center",
  }
}

export function helpText() {
  return [
    "Harvester Command Center",
    "/start — open the persistent Command Center keyboard",
    "/menu — restore the persistent keyboard",
    "/status — runtime readiness and blockers",
    "/markets — configured market prices, freshness and blockers",
    "/positions — canonical active and retained inventory with recovery accounting",
    "/orders — Harvester-owned and external open orders",
    "/balances — latest exchange free and locked balances with snapshot age",
    "/pause SYMBOL — block new BUYs and cancel active Harvester-owned BUY orders for one market",
    "/resume SYMBOL — remove that market's BUY pause; other safety gates still apply",
    "/pauseallbuys — stop all BUY submissions and cancel active Harvester-owned BUY orders",
    "/resumeallbuys — remove the global emergency BUY pause",
    "/pausebuys SYMBOL — compatibility alias for /pause SYMBOL",
    "/resumebuys SYMBOL — compatibility alias for /resume SYMBOL",
    "/help — show this help",
    "",
    "Inline pause/resume buttons always require confirmation. Text control commands are explicit requests.",
    "Market Pause blocks new BUYs, cancels active current-process-owned BUYs, and reconciles fills that race cancellation.",
    "Recovery SELLs, fill accounting and reconciliation continue. Manual, external and prior-process orders are never canceled.",
    "If owned-BUY cancellation is unresolved, the BUY gate stays active; inspect /orders and Harvester diagnostics.",
    "Inline Pause/Resume buttons require confirmation; slash commands execute after private-chat authorization.",
    "BUY pause state lasts only for this process and is not restored after restart.",
  ].join("\n")
}

export const PAGE_METHODS = Object.freeze({
  status: "getStatus",
  markets: "getMarkets",
  positions: "getPositions",
  orders: "getOrders",
  balances: "getBalances",
})

export const PAGE_TITLES = Object.freeze({
  status: "runtime status",
  markets: "market snapshot",
  positions: "position snapshot",
  orders: "order snapshot",
  balances: "balance snapshot",
})
