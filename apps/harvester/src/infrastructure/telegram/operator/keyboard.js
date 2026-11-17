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
      if (marketAction === "PAUSE" && market.operatorPaused === true) { continue }
      if (marketAction === "RESUME" && market.operatorPaused !== true) { continue }
      const action = market.operatorPaused === true ? "RESUME" : "PAUSE"
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
    "/pause SYMBOL — request a market-scoped operator pause",
    "/resume SYMBOL — request removal of the operator-owned pause",
    "/pauseallbuys — stop all BUY submissions and cancel active Harvester-owned BUY orders",
    "/resumeallbuys — remove the global emergency BUY pause",
    "/pausebuys SYMBOL — stop BUYs and cancel active Harvester-owned BUYs for one market",
    "/resumebuys SYMBOL — remove one market emergency BUY pause",
    "/help — show this help",
    "",
    "Inline pause/resume buttons always require confirmation. Text control commands are explicit requests.",
    "Operator pause does not cancel existing orders. Existing orders may still fill; accounting and recovery SELLs continue.",
    "Emergency BUY pause cancels only current-process-owned BUYs. Recovery SELLs and accounting continue; manual/external orders are untouched.",
    "Emergency BUY commands execute immediately after private-chat authorization; they do not use the market-button confirmation flow.",
    "Operator pause lasts only for this process and is not restored after restart.",
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
