function formatTimestamp(timestamp) {
  if (!Number.isSafeInteger(timestamp)) {return "unknown"}
  try {return new Date(timestamp).toISOString()} catch {return "unknown"}
}

function formatAge(ageMs) {
  if (!Number.isSafeInteger(ageMs) || ageMs < 0) {return "unknown"}
  if (ageMs < 1000) {return `${ageMs  }ms ago`}
  return `${Math.round(ageMs / 1000)  }s ago`
}

function formatUserDataLine({ userData }) {
  const readiness = userData.ready === true ? "READY" : "NOT READY"
  return `User data: ${readiness} (${String(userData.status ?? "UNKNOWN")}; last event ${formatAge(userData.ageMs)})`
}

function formatMarketCountsLine({ marketCounts }) {
  return `Markets: ${marketCounts.enabled ?? 0} enabled / ${marketCounts.configured ?? 0} configured (${marketCounts.blocked ?? 0} blocked)`
}

function appendStatusBlockers({ lines, blockers }) {
  if (Array.isArray(blockers) && blockers.length > 0) {
    lines.push(`Blockers: ${blockers.join(", ")}`)
  }
}

function formatMarketPriceLine({ market }) {
  const hasPrice = market.latestPrice !== null && market.latestPrice !== undefined
  let priceStatus = "stale"
  if (!hasPrice) {
    priceStatus = "unavailable"
  } else if (market.priceFresh === true) {
    priceStatus = "fresh"
  }
  return `Price: ${market.latestPrice ?? "unavailable"} (${priceStatus})`
}

function formatMarketVolatilityLine({ market }) {
  if (!market.volatilityProtection) {return null}
  return `Volatility: ${market.volatilityProtection.mode}${market.volatilityProtection.reason ? ` (${market.volatilityProtection.reason})` : ""}`
}

function appendMarketBlockers({
    lines,
    market,
  }) {
  if (Array.isArray(market.blockers) && market.blockers.length > 0) {
    lines.push(`Blockers: ${market.blockers.join(", ")}`)
  }
}

function appendMarketDetails({
      lines,
      market,
    }) {
  if (market.priceTimestamp !== null && market.priceTimestamp !== undefined) {
    lines.push(`Price updated: ${formatTimestamp(market.priceTimestamp)}`)
  }
  lines.push(`Operator pause: ${market.operatorPaused ? "ACTIVE" : "OFF"}`)
  lines.push(`Safety pause: ${market.safetyPaused ? "ACTIVE" : "OFF"}`)
  lines.push(`Recovery pause: ${market.recoveryManagedPaused ? "ACTIVE" : "OFF"}`)
  const volatilityLine = formatMarketVolatilityLine({ market })
  if (volatilityLine) {lines.push(volatilityLine)}
  appendMarketBlockers({ lines, market })
}

export function formatTelegramOperatorStatus({ status } = {}) {
  if (!status || typeof status !== "object") {
    throw new TypeError("formatTelegramOperatorStatus requires a status snapshot")
  }
  const userData = status.userData ?? {}
  const readiness = status.readiness ?? {}
  const marketCounts = status.markets ?? {}
  const runtimeState = status.runtimeState ?? (status.connected === true ? "RUNNING" : "UNKNOWN")
  const lines = [
    "Harvester status",
    `Runtime: ${  runtimeState}`,
    `Broker: ${  String(status.broker ?? "unknown").toUpperCase()}`,
    `Strategy: ${  String(status.strategyMode ?? "unknown").toUpperCase()}`,
    `Broker mode: ${  String(status.tradingMode ?? "unknown").toUpperCase()}`,
    `Trading: ${  status.tradingEnabled ? "ENABLED" : "DISABLED"}`,
    `Readiness: ${  String(readiness.state ?? "UNKNOWN")}`,
    formatUserDataLine({ userData }),
    formatMarketCountsLine({ marketCounts }),
  ]
  appendStatusBlockers({
    lines,
    blockers: readiness.blockers,
  })
  if (status.stopping === true) {lines.push("Runtime is stopping.")}
  lines.push(`Observed: ${  formatTimestamp(status.observedAt)}`)
  return lines.join("\n")
}

export function formatTelegramOperatorMarkets({ snapshot } = {}) {
  if (!snapshot || !Array.isArray(snapshot.markets)) {
    throw new TypeError("formatTelegramOperatorMarkets requires a market snapshot")
  }
  const lines = ["Harvester markets"]
  if (snapshot.markets.length === 0) {lines.push("No configured markets.")}
  for (const market of snapshot.markets) {
    lines.push("")
    lines.push(`${market.symbol  } — ${  String(market.readiness ?? "UNKNOWN")}`)
    lines.push(formatMarketPriceLine({ market }))
    appendMarketDetails({ lines, market })
  }
  const message = lines.join("\n")
  return message.length <= 3900 ? message : `${message.slice(0, 3850)  }\n… additional market details omitted`
}


function formatObservedAt(snapshot) {
  return `Observed: ${  formatTimestamp(snapshot.observedAt)}`
}

export function formatTelegramOperatorPositions({ snapshot } = {}) {
  if (!snapshot || !Array.isArray(snapshot.positions)) {
    throw new TypeError("formatTelegramOperatorPositions requires a position snapshot")
  }
  const lines = ["Harvester positions"]
  if (snapshot.positions.length === 0) { lines.push("No accounted positions.") }
  for (const position of snapshot.positions) {
    lines.push("")
    lines.push(`${position.symbol  } — active ${  position.activeQuantity  } ${  position.baseAsset}`)
    lines.push(`Free inventory: ${  position.freeQuantity  } ${  position.baseAsset}`)
    lines.push(`Total inventory: ${  position.totalQuantity  } ${  position.baseAsset}`)
    lines.push(`Invested: ${  position.investedQuote  } ${  position.quoteAsset}`)
    lines.push(`Net quote cash flow: ${  position.quoteNetCashFlow  } ${  position.quoteAsset}`)
    if (position.recovery) {
      lines.push(`Recovery buy cost: ${  position.recovery.buyCost  } ${  position.quoteAsset}`)
      lines.push(`Net sell proceeds: ${  position.recovery.netSellProceeds  } ${  position.quoteAsset}`)
      lines.push(`Outstanding recovery: ${  position.recovery.outstandingRecoveryAmount  } ${  position.quoteAsset}`)
      lines.push(`Realized net profit: ${  position.recovery.realizedNetProfit  } ${  position.quoteAsset}`)
    }
  }
  lines.push(formatObservedAt(snapshot))
  const message = lines.join("\n")
  return message.length <= 3900 ? message : `${message.slice(0, 3850)  }\n… additional positions omitted`
}

export function formatTelegramOperatorOrders({ snapshot } = {}) {
  if (!snapshot || !Array.isArray(snapshot.orders)) {
    throw new TypeError("formatTelegramOperatorOrders requires an order snapshot")
  }
  const lines = ["Harvester orders"]
  if (snapshot.orders.length === 0) { lines.push("No open orders reported.") }
  for (const order of snapshot.orders) {
    lines.push("")
    lines.push(`${String(order.ownership ?? "UNKNOWN")  } ${  String(order.symbol ?? "UNKNOWN") 
      } ${  String(order.side ?? "UNKNOWN")  } — ${  String(order.status ?? "UNKNOWN")}`)
    lines.push(`Order: ${  String(order.brokerOrderId ?? "unknown") 
      } / client ${  String(order.clientOrderId ?? "unknown")}`)
    lines.push(`Price: ${  String(order.price ?? "unknown") 
      } | quantity: ${  String(order.quantity ?? "unknown") 
      } | filled: ${  String(order.executedQuantity ?? "unknown")}`)
  }
  lines.push(formatObservedAt(snapshot))
  const message = lines.join("\n")
  return message.length <= 3900 ? message : `${message.slice(0, 3850)  }\n… additional orders omitted`
}

export function formatTelegramOperatorBalances({ snapshot } = {}) {
  if (!snapshot || !Array.isArray(snapshot.balances)) {
    throw new TypeError("formatTelegramOperatorBalances requires a balance snapshot")
  }
  const lines = [
    "Harvester exchange balances",
    `Source: ${  formatTimestamp(snapshot.sourceTime)  } (${  formatAge(snapshot.ageMs)  })`,
  ]
  if (snapshot.balances.length === 0) { lines.push("No balances reported.") }
  for (const balance of snapshot.balances) {
    lines.push(`${String(balance.asset ?? "UNKNOWN")  }: free ${  String(balance.free ?? "unknown") 
      } | locked ${  String(balance.locked ?? "unknown") 
      } | total ${  String(balance.total ?? "unknown")}`)
  }
  lines.push(formatObservedAt(snapshot))
  const message = lines.join("\n")
  return message.length <= 3900 ? message : `${message.slice(0, 3850)  }\n… additional balances omitted`
}
