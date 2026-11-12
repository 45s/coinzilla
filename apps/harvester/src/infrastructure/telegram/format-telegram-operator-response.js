function formatTimestamp(timestamp) {
  if (!Number.isSafeInteger(timestamp)) {return "unknown"}
  try {return new Date(timestamp).toISOString()} catch {return "unknown"}
}

function formatAge(ageMs) {
  if (!Number.isSafeInteger(ageMs) || ageMs < 0) {return "unknown"}
  if (ageMs < 1000) {return ageMs + "ms ago"}
  return Math.round(ageMs / 1000) + "s ago"
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
    "Runtime: " + runtimeState,
    "Broker: " + String(status.broker ?? "unknown").toUpperCase(),
    "Strategy: " + String(status.strategyMode ?? "unknown").toUpperCase(),
    "Broker mode: " + String(status.tradingMode ?? "unknown").toUpperCase(),
    "Trading: " + (status.tradingEnabled ? "ENABLED" : "DISABLED"),
    "Readiness: " + String(readiness.state ?? "UNKNOWN"),
    "User data: " + (userData.ready === true ? "READY" : "NOT READY") +
      " (" + String(userData.status ?? "UNKNOWN") + "; last event " + formatAge(userData.ageMs) + ")",
    "Markets: " + (marketCounts.enabled ?? 0) + " enabled / " +
      (marketCounts.configured ?? 0) + " configured (" + (marketCounts.blocked ?? 0) + " blocked)",
  ]
  if (Array.isArray(readiness.blockers) && readiness.blockers.length > 0) {
    lines.push("Blockers: " + readiness.blockers.join(", "))
  }
  if (status.stopping === true) {lines.push("Runtime is stopping.")}
  lines.push("Observed: " + formatTimestamp(status.observedAt))
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
    lines.push(market.symbol + " — " + String(market.readiness ?? "UNKNOWN"))
    const hasPrice = market.latestPrice !== null && market.latestPrice !== undefined
    let priceStatus = "stale"
    if (!hasPrice) {
      priceStatus = "unavailable"
    } else if (market.priceFresh === true) {
      priceStatus = "fresh"
    }
    lines.push("Price: " + (market.latestPrice ?? "unavailable") + " (" + priceStatus + ")")
    if (market.priceTimestamp !== null && market.priceTimestamp !== undefined) {
      lines.push("Price updated: " + formatTimestamp(market.priceTimestamp))
    }
    lines.push("Operator pause: " + (market.operatorPaused ? "ACTIVE" : "OFF"))
    lines.push("Safety pause: " + (market.safetyPaused ? "ACTIVE" : "OFF"))
    lines.push("Recovery pause: " + (market.recoveryManagedPaused ? "ACTIVE" : "OFF"))
    if (market.volatilityProtection) {
      lines.push("Volatility: " + market.volatilityProtection.mode +
        (market.volatilityProtection.reason ? " (" + market.volatilityProtection.reason + ")" : ""))
    }
    if (Array.isArray(market.blockers) && market.blockers.length > 0) {
      lines.push("Blockers: " + market.blockers.join(", "))
    }
  }
  const message = lines.join("\n")
  return message.length <= 3900 ? message : message.slice(0, 3850) + "\n… additional market details omitted"
}
