const UNSAFE_USER_DATA_STATUSES = new Set([
  "CONNECTIONCLOSED",
  "RECOVERING",
  "RECOVERED",
  "RECOVERYFAILED",
  "TERMINATED",
  "RPCERROR",
  "EXECUTIONNORMALIZATIONFAILED",
  "INVALIDEVENT",
  "EXECUTIONACCOUNTINGFAILED",
])

const CHECK_SOURCES = Object.freeze({
  "runtime.lifecycle": "Harvester runtime lifecycle snapshot",
  "configuration.validation": "Resolved effective Harvester configuration",
  "broker.connection": "Existing connected BrokerPort composition result",
  "broker.capabilities": "Application-owned BROKER_PORT_METHODS contract",
  "process.restoration": "Verified durable operational-state process ledger",
  "account.preflight": "Account snapshot manager durable PREFLIGHT audit",
  "account.open-orders": "Account snapshot manager durable open-order audit",
  "account.safety-blocker": "Existing account-scoped safety-blocker projection",
  "user-data.reconciliation": "User-data subscription and authoritative reconciliation state",
  "engine.market-snapshots": "Existing trading-engine operator market snapshot query",
  "startup.failure": "Original Harvester startup stage error code",
  "market.route": "Per-symbol market-data provider identity and subscription state",
  "market.price": "Accepted market-price event and existing engine freshness snapshot",
  "market.book": "Accepted order-book event and existing engine freshness snapshot",
  "market.metadata": "Existing exchange market metadata validation snapshot",
  "market.volatility": "Candle-history service snapshot and engine protection state",
  "market.engine-safety": "Existing per-market engine submission blockers",
})

function freezeValue(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeValue))
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [key, freezeValue(entry)])
    return Object.freeze(Object.fromEntries(entries))
  }
  return value
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function ageMs({ observedAt, timestamp } = {}) {
  if (!isTimestamp(observedAt) || !isTimestamp(timestamp)) {
    return null
  }
  return Math.max(0, observedAt - timestamp)
}

function normalizeUserDataStatus(status) {
  return String(status ?? "").replace(/[^a-zA-Z]/g, "").toUpperCase()
}

function safeIdentity(identity) {
  if (!identity || typeof identity !== "object") {
    return null
  }
  return {
    providerInstanceId: identity.providerInstanceId ?? null,
    providerType: identity.providerType ?? null,
    environment: identity.environment ?? null,
  }
}

function identitiesMatch({ expected, actual } = {}) {
  if (!expected || !actual) {
    return false
  }
  const requiredFields = ["providerInstanceId", "providerType", "environment"]
  for (const field of [...requiredFields, "accountId"]) {
    if (expected[field] !== undefined && expected[field] !== null &&
        expected[field] !== actual[field]) {
      return false
    }
  }
  return requiredFields.every((field) =>
    typeof actual[field] === "string" && actual[field].length > 0)
}

function getCheckSeverity({ status, blocksTrading } = {}) {
  if (status === "BLOCKED" && blocksTrading) {
    return "CRITICAL"
  }
  if (status === "WARNING") {
    return "WARNING"
  }
  return "INFO"
}

function getEvidenceState(status) {
  if (status === "PASS") {
    return "CURRENT"
  }
  if (status === "WARNING") {
    return "DEGRADED"
  }
  if (status === "BLOCKED") {
    return "MISSING_OR_UNSAFE"
  }
  return "NOT_APPLICABLE"
}

/**
 * Create a structured, source-labelled diagnostic without performing operational work.
 *
 * @param {object} options
 * @returns {object} One immutable-ready diagnostic record.
 */
function createCheck({
  id,
  scope,
  status,
  code,
  message,
  expected,
  remediation,
  details = {},
  observedAt,
  blocksTrading,
  possibleCauses = [],
  recovery = null,
} = {}) {
  const blocks = blocksTrading ?? status === "BLOCKED"
  const sourceOfTruth = CHECK_SOURCES[id] ?? "Harvester startup readiness projection"
  return {
    id,
    scope,
    status,
    severity: getCheckSeverity({ status, blocksTrading: blocks }),
    evidenceState: getEvidenceState(status),
    code,
    sourceOfTruth,
    observedAt,
    expected,
    observed: details,
    diagnosis: message,
    message,
    possibleCauses,
    recovery,
    impact: blocks ? "TRADING_BLOCKED" : "NO_GLOBAL_TRADING_IMPACT",
    remediation,
    operatorAction: remediation,
    blocksTrading: blocks,
    details,
  }
}

function createRuntimeLifecycleCheck({ runtime, observedAt } = {}) {
  let status = "BLOCKED"
  let code = "RUNTIME_STATE_UNKNOWN"
  let message = "The runtime lifecycle state is not confirmed."
  if (runtime.stopping === true || ["STOPPING", "STOPPED"].includes(runtime.runtimeState)) {
    code = "RUNTIME_STOPPING"
    message = "Harvester is stopping; trading activation is prohibited."
  } else if (runtime.runtimeState === "RUNNING" || runtime.startupBoundary === true) {
    status = "PASS"
    code = "RUNTIME_ACTIVE"
    message = "The Harvester startup lifecycle is active."
  }
  return createCheck({
    id: "runtime.lifecycle",
    scope: "RUNTIME",
    status,
    code,
    message,
    expected: "An active Harvester lifecycle that is not stopping.",
    remediation: "Wait for a clean startup or inspect the original lifecycle failure.",
    observedAt,
    details: {
      runtimeState: runtime.runtimeState ?? "UNKNOWN",
      stopping: runtime.stopping === true,
      startupBoundary: runtime.startupBoundary === true,
      startupComplete: runtime.startupComplete === true,
    },
  })
}

function createConfigurationCheck({ runtime, inputs, observedAt } = {}) {
  const configuration = inputs.configuration ?? {}
  const enabledMarkets = configuration.enabledMarkets
  let valid = configuration.validated === true && Array.isArray(enabledMarkets)
  if (runtime.tradingEnabled === true && Array.isArray(enabledMarkets) && enabledMarkets.length === 0) {
    valid = false
  }
  let status = "BLOCKED"
  let code = "CONFIGURATION_NOT_VALIDATED"
  let message = "Required effective configuration evidence is unavailable."
  if (valid) {
    status = "PASS"
    code = "CONFIGURATION_VALIDATED"
    message = "Effective configuration and enabled-market selection were validated."
  }
  return createCheck({
    id: "configuration.validation",
    scope: "RUNTIME",
    status,
    code,
    message,
    expected: "Validated required settings, safety constraints and a consistent market selection.",
    remediation: "Correct the named configuration setting and restart; secret values are never included.",
    observedAt,
    details: {
      validated: configuration.validated === true,
      enabledMarketCount: Array.isArray(enabledMarkets) ? enabledMarkets.length : null,
    },
  })
}

function createBrokerConnectionCheck({ inputs, observedAt } = {}) {
  const broker = inputs.broker ?? {}
  const connected = broker.connected === true
  let status = "BLOCKED"
  let code = "BROKER_NOT_CONNECTED"
  let message = "The execution BrokerPort connection is not confirmed."
  if (connected) {
    status = "PASS"
    code = "BROKER_CONNECTED"
    message = "The selected execution BrokerPort connection was established."
  }
  return createCheck({
    id: "broker.connection",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "The configured execution BrokerPort is connected.",
    remediation: "Verify broker connectivity and inspect the original sanitized connection error.",
    observedAt,
    details: {
      connected,
      identity: safeIdentity(broker.identity),
    },
  })
}

function createBrokerCapabilitiesCheck({ inputs, observedAt } = {}) {
  const capabilities = inputs.broker?.capabilities ?? {}
  const missing = Array.isArray(capabilities.missing) ? capabilities.missing : null
  const complete = capabilities.validated === true && Array.isArray(missing) && missing.length === 0
  let status = "BLOCKED"
  let code = "BROKER_CAPABILITIES_INCOMPLETE"
  let message = "One or more required BrokerPort methods are missing or could not be verified."
  if (complete) {
    status = "PASS"
    code = "BROKER_CAPABILITIES_VERIFIED"
    message = "The application-owned BrokerPort method surface is available."
  }
  return createCheck({
    id: "broker.capabilities",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "Every method declared by BROKER_PORT_METHODS is available.",
    remediation: "Use a broker adapter implementing the application-owned BrokerPort contract.",
    observedAt,
    details: {
      required: Array.isArray(capabilities.required) ? capabilities.required : [],
      missing,
      validationScope: "Structural BrokerPort methods only; exchange account permissions are not inferred.",
    },
  })
}

function createProcessRestorationCheck({ inputs, observedAt } = {}) {
  const continuity = inputs.processContinuity ?? {}
  let status = "BLOCKED"
  let code = "PROCESS_CONTINUITY_UNKNOWN"
  let message = "The durable process ledger did not provide a definitive prior-process result."
  let remediation = "Inspect the durable process ledger and follow the approved recovery procedure."
  if (continuity.storeConfigured !== true) {
    status = "NOT_APPLICABLE"
    code = "PROCESS_CONTINUITY_STORE_NOT_CONFIGURED"
    message = "No durable process-continuity store is configured; prior-process history is unknown."
    remediation = "Configure the approved durable operational-state store if process continuity is required."
  } else if (continuity.previousProcessStarted === true && continuity.restorationEnabled !== true) {
    code = "PROCESS_RESTART_RESTORATION_DISABLED"
    message = "A prior process session was detected. Runtime restoration remains disabled."
    remediation = "Complete the approved restart and reconciliation procedure; this report never restores trading state."
  } else if (continuity.previousProcessStarted === false) {
    status = "NOT_APPLICABLE"
    code = "NO_PRIOR_PROCESS_SESSION"
    message = "The verified process ledger contains no prior process session."
    remediation = "No process-restoration action is required."
  }
  return createCheck({
    id: "process.restoration",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "No unresolved prior process session; automatic restoration remains disabled.",
    remediation,
    observedAt,
    details: {
      storeConfigured: continuity.storeConfigured === true,
      previousProcessStarted: continuity.storeConfigured === true
        ? continuity.previousProcessStarted ?? null
        : null,
      restorationEnabled: continuity.restorationEnabled === true,
    },
  })
}

function createAccountPreflightCheck({ inputs, observedAt } = {}) {
  const preflight = inputs.account?.preflight ?? {}
  const complete = preflight.completed === true &&
    preflight.durable === true &&
    isTimestamp(preflight.sourceTime) &&
    Number.isSafeInteger(preflight.balanceCount)
  let status = "BLOCKED"
  let code = "ACCOUNT_PREFLIGHT_INCOMPLETE"
  let message = "The account PREFLIGHT snapshot or its durability barrier is incomplete."
  if (complete) {
    status = "PASS"
    code = "ACCOUNT_PREFLIGHT_COMPLETE"
    message = "The account PREFLIGHT snapshot completed its existing durability barrier."
  }
  return createCheck({
    id: "account.preflight",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "A complete account snapshot with a valid source timestamp and durable audit flush.",
    remediation: "Inspect account snapshot retrieval, lifecycle-event publication and the existing Journal PREFLIGHT flush barrier.",
    observedAt,
    details: {
      completed: preflight.completed === true,
      durable: preflight.durable === true,
      sourceTime: isTimestamp(preflight.sourceTime) ? preflight.sourceTime : null,
      ageMs: ageMs({ observedAt, timestamp: preflight.sourceTime }),
      balanceCount: Number.isSafeInteger(preflight.balanceCount) ? preflight.balanceCount : null,
    },
  })
}

function isExternalOrderOnlyAudit({ openOrders } = {}) {
  const symbols = openOrders.unownedSymbols
  const reasons = openOrders.blockReasons
  if (!Array.isArray(symbols) || symbols.length === 0 || !Array.isArray(reasons) || reasons.length === 0) {
    return false
  }
  return reasons.every((reason) => String(reason).startsWith("UNOWNED_OPEN_ORDERS"))
}

function createOpenOrdersCheck({ inputs, observedAt } = {}) {
  const openOrders = inputs.account?.openOrders ?? {}
  const externalOrderOnly = isExternalOrderOnlyAudit({ openOrders })
  const complete = openOrders.completed === true &&
    openOrders.durable === true &&
    isTimestamp(openOrders.observedAt) &&
    Number.isSafeInteger(openOrders.orderCount)
  let status = "BLOCKED"
  let code = "ACCOUNT_OPEN_ORDERS_AUDIT_INCOMPLETE"
  let message = "The account-wide open-order audit is incomplete or contains an unresolved condition."
  let blocksTrading = true
  if (complete && externalOrderOnly) {
    status = "WARNING"
    code = "UNOWNED_EXTERNAL_ORDERS_OBSERVED"
    message = "The account snapshot contains unowned external orders; existing per-market policy determines impact."
    blocksTrading = false
  } else if (complete && (openOrders.blockReasons?.length ?? 0) === 0) {
    status = "PASS"
    code = "ACCOUNT_OPEN_ORDERS_AUDITED"
    message = "The account-wide open-order PREFLIGHT audit completed and was durably recorded."
    blocksTrading = false
  }
  return createCheck({
    id: "account.open-orders",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "A complete, durable account-wide open-order snapshot with ownership classification.",
    remediation: externalOrderOnly
      ? "Review affected symbols and their externalOrdersPolicy; do not adopt, cancel or modify these orders automatically."
      : "Complete the approved account-wide open-order audit and resolve non-external-order reconciliation blockers.",
    observedAt,
    blocksTrading,
    details: {
      completed: openOrders.completed === true,
      durable: openOrders.durable === true,
      phase: openOrders.phase ?? null,
      observedAt: isTimestamp(openOrders.observedAt) ? openOrders.observedAt : null,
      ageMs: ageMs({ observedAt, timestamp: openOrders.observedAt }),
      orderCount: Number.isSafeInteger(openOrders.orderCount) ? openOrders.orderCount : null,
      unownedSymbols: Array.isArray(openOrders.unownedSymbols) ? openOrders.unownedSymbols : [],
      blockReasons: Array.isArray(openOrders.blockReasons) ? openOrders.blockReasons : [],
      externalOrderOnly,
    },
  })
}

function createAccountSafetyCheck({ inputs, observedAt } = {}) {
  const blocker = inputs.accountSafety?.blocker ?? null
  let status = "PASS"
  let code = "ACCOUNT_SAFETY_CLEAR"
  let message = "No account-scoped safety blocker is active."
  let blocksTrading = false
  if (blocker && blocker.scope === "ACCOUNT") {
    status = "BLOCKED"
    code = blocker.reason ?? "ACCOUNT_SAFETY_BLOCKER_ACTIVE"
    message = "An existing account-scoped safety blocker prohibits trading activation."
    blocksTrading = true
  } else if (blocker) {
    status = "WARNING"
    code = blocker.reason ?? "NON_ACCOUNT_SAFETY_BLOCKER_ACTIVE"
    message = "A non-account-scoped safety condition is active; its owning scope remains responsible for enforcement."
  }
  return createCheck({
    id: "account.safety-blocker",
    scope: "ACCOUNT",
    status,
    code,
    message,
    expected: "No ACCOUNT-scoped safety blocker remains active.",
    remediation: "Resolve the existing safety blocker through its owning recovery or operator workflow.",
    observedAt,
    blocksTrading,
    details: {
      scope: blocker?.scope ?? null,
      reason: blocker?.reason ?? null,
      blockerId: blocker?.blockerId ?? null,
    },
  })
}

function getUserDataSafetyFacts({ runtime, inputs } = {}) {
  const userData = inputs.userData ?? {}
  const userDataStatus = userData.status ?? runtime.userData?.status ?? "UNKNOWN"
  const normalizedStatus = normalizeUserDataStatus(userDataStatus)
  const reconciliationRequired = userData.requiresReconciliation === true ||
    (userDataStatus === "AUTHORITATIVE_RECONCILIATION_REQUIRED" && userData.preflightComplete !== true)
  const unsafe = userData.accountingFailed === true ||
    userData.streamUnsafe === true ||
    userData.pendingRecovery === true ||
    userData.safetyHaltRequired === true ||
    userData.retryableRecoveryFailure === true ||
    reconciliationRequired ||
    UNSAFE_USER_DATA_STATUSES.has(normalizedStatus)
  const activationReady = runtime.tradingEnabled !== true ||
    runtime.userData?.ready === true ||
    runtime.startupBoundary === true
  const ready = userData.subscriptionEstablished === true &&
    userData.preflightComplete === true &&
    !unsafe &&
    activationReady
  let status = "BLOCKED"
  let code = "USER_DATA_PREFLIGHT_INCOMPLETE"
  let message = "User-data subscription or authoritative PREFLIGHT reconciliation evidence is incomplete."
  if (ready) {
    status = "PASS"
    code = "USER_DATA_PREFLIGHT_COMPLETE"
    message = "User-data subscription, account PREFLIGHT and queued-event reconciliation are complete."
  } else if (reconciliationRequired) {
    code = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    message = "User-data recovery or reconciliation remains unresolved."
  } else if (unsafe) {
    code = "USER_DATA_RECONCILIATION_UNSAFE"
    message = "User-data synchronization or accounting state is unsafe."
  } else if (runtime.tradingEnabled === true &&
      runtime.userData?.ready !== true &&
      runtime.startupBoundary !== true) {
    code = "USER_DATA_NOT_READY"
    message = "The existing user-data trading-readiness gate is closed."
  }
  return {
    userData,
    userDataStatus,
    status,
    code,
    message,
  }
}

function createUserDataDetails({ facts, runtime, observedAt } = {}) {
  const { userData, userDataStatus } = facts
  const lastStatusEventAt = userData.lastStatusEventAt ?? runtime.userData?.lastEventAt
  return {
    subscriptionEstablished: userData.subscriptionEstablished === true,
    preflightComplete: userData.preflightComplete === true,
    ready: runtime.userData?.ready === true,
    activationDeferred: userData.tradingActivationDeferred === true,
    activationPending: runtime.startupBoundary === true && runtime.userData?.ready !== true,
    status: userDataStatus,
    requiresReconciliation: userData.requiresReconciliation === true,
    accountingFailed: userData.accountingFailed === true,
    streamUnsafe: userData.streamUnsafe === true,
    pendingRecovery: userData.pendingRecovery === true,
    safetyHaltRequired: userData.safetyHaltRequired === true,
    retryableRecoveryFailure: userData.retryableRecoveryFailure === true,
    lastStatusEventAt: isTimestamp(lastStatusEventAt) ? lastStatusEventAt : null,
    lastStatusEventAgeMs: ageMs({ observedAt, timestamp: lastStatusEventAt }),
  }
}

function createUserDataCheck({ runtime, inputs, observedAt } = {}) {
  const facts = getUserDataSafetyFacts({ runtime, inputs })
  return createCheck({
    id: "user-data.reconciliation",
    scope: "ACCOUNT",
    status: facts.status,
    code: facts.code,
    message: facts.message,
    expected: "An established stream, completed authoritative PREFLIGHT reconciliation and no recovery/accounting blockers.",
    remediation: "Restore user-data delivery, complete authoritative account/open-order reconciliation and verify queued events are drained.",
    observedAt,
    details: createUserDataDetails({ facts, runtime, observedAt }),
  })
}
function createRuntimeChecks({ runtime, inputs, observedAt } = {}) {
  return [
    createRuntimeLifecycleCheck({ runtime, observedAt }),
    createConfigurationCheck({ runtime, inputs, observedAt }),
    createBrokerConnectionCheck({ inputs, observedAt }),
    createBrokerCapabilitiesCheck({ inputs, observedAt }),
    createProcessRestorationCheck({ inputs, observedAt }),
    createAccountPreflightCheck({ inputs, observedAt }),
    createOpenOrdersCheck({ inputs, observedAt }),
    createAccountSafetyCheck({ inputs, observedAt }),
    createUserDataCheck({ runtime, inputs, observedAt }),
  ]
}

function createEngineSnapshotCheck({ readinessInputs, observedAt } = {}) {
  const enabledMarkets = readinessInputs.configuration?.enabledMarkets
  const configuredCount = Array.isArray(enabledMarkets) ? enabledMarkets.length : 0
  return createCheck({
    id: "engine.market-snapshots",
    scope: "RUNTIME",
    status: "BLOCKED",
    code: "ENGINE_MARKET_SNAPSHOT_UNAVAILABLE",
    message: "The engine did not provide the configured per-market readiness snapshots.",
    expected: "A successful engine operator snapshot for every configured market.",
    remediation: "Inspect engine startup and market snapshot diagnostics; trading activation remains closed.",
    observedAt,
    details: {
      configuredMarketCount: configuredCount,
    },
  })
}

function createStartupFailureCheck({ startupFailure, observedAt } = {}) {
  const candidateCode = String(startupFailure.code ?? "")
  let safeCode = "HARVESTER_STARTUP_FAILED"
  if (/^[A-Z0-9_]{1,80}$/.test(candidateCode)) {
    safeCode = candidateCode
  }
  return createCheck({
    id: "startup.failure",
    scope: "RUNTIME",
    status: "BLOCKED",
    code: safeCode,
    message: `The ${startupFailure.component ?? "startup"} stage failed before readiness could be established.`,
    expected: "All required startup stages complete without an error.",
    remediation: "Resolve the original startup failure shown in the preceding Harvester diagnostic and retry startup.",
    observedAt,
    details: {
      component: startupFailure.component ?? "UNKNOWN",
    },
  })
}

function createMarketCheck(options = {}) {
  return createCheck({
    ...options,
    scope: "MARKET",
  })
}

function createDisabledMarketReport({ market, observedAt } = {}) {
  const check = createMarketCheck({
    id: "market.configuration",
    status: "NOT_APPLICABLE",
    code: "MARKET_DISABLED",
    message: "The market is disabled by effective runtime configuration.",
    expected: "Only explicitly enabled markets participate in trading.",
    remediation: "Enable the market explicitly if it should participate in this runtime.",
    observedAt,
    details: {
      enabled: false,
    },
  })
  return {
    symbol: market.symbol,
    enabled: false,
    readiness: "DISABLED",
    blockers: ["MARKET_DISABLED"],
    warnings: [],
    checks: [check],
  }
}

function getBookRequired({ market, input, runtime } = {}) {
  if (runtime.tradingEnabled !== true) {
    return false
  }
  if (input.book?.required !== undefined) {
    return input.book.required === true
  }
  if (market.bookRequired !== undefined) {
    return market.bookRequired === true
  }
  return market.orderType !== "LIMIT"
}

function createMarketRouteCheck({ market, input, routeRequired, bookRequired, observedAt } = {}) {
  const route = input.route ?? {}
  const expected = route.expected
  const priceIdentity = route.priceSourceIdentity ?? route.actual
  const bookIdentity = route.bookSourceIdentity ?? route.actual
  let matches = true
  if (routeRequired) {
    matches = identitiesMatch({ expected, actual: priceIdentity }) &&
      route.priceSubscriptionReady === true
    if (matches && bookRequired) {
      matches = identitiesMatch({ expected, actual: bookIdentity }) &&
        route.bookSubscriptionReady === true
    }
  }
  let status = "PASS"
  let code = "MARKET_DATA_ROUTE_VERIFIED"
  let message = "Market-data price and required book streams use the configured provider route."
  if (!routeRequired) {
    status = "NOT_APPLICABLE"
    code = "MARKET_DATA_ROUTE_NOT_REQUIRED"
    message = "Market-data subscription is intentionally suppressed by external-order policy."
  } else if (!matches) {
    status = "BLOCKED"
    code = "MARKET_DATA_ROUTE_NOT_VERIFIED"
    message = "Market-data subscription or provider/account/environment identity is missing or mismatched."
  }
  return createMarketCheck({
    id: "market.route",
    status,
    code,
    message,
    expected: "The expected provider instance, provider type, environment and account identity match the active subscriptions.",
    remediation: "Verify the per-symbol market-data provider route; do not silently fall back to another provider.",
    observedAt,
    details: {
      symbol: market.symbol,
      expected: safeIdentity(expected),
      actualPriceSource: safeIdentity(priceIdentity),
      actualBookSource: bookRequired ? safeIdentity(bookIdentity) : null,
      priceSubscriptionReady: route.priceSubscriptionReady === true,
      bookSubscriptionReady: route.bookSubscriptionReady === true,
      required: routeRequired,
    },
  })
}

function createMarketPriceCheck({ market, input, routeRequired, observedAt } = {}) {
  const route = input.route ?? {}
  const price = input.price ?? {}
  const source = price.source ?? "UNKNOWN"
  const eventReceived = price.websocketEventReceived === true
  const validSource = source === "INITIAL_SEED" || (source === "WEBSOCKET" && eventReceived)
  const ready = market.priceFresh === true &&
    isTimestamp(market.priceTimestamp) &&
    route.priceSubscriptionReady === true &&
    validSource
  let status = "BLOCKED"
  let code = "MARKET_PRICE_NOT_READY"
  let message = "No valid fresh market price is confirmed; subscription acknowledgement alone is insufficient."
  if (!routeRequired) {
    status = "NOT_APPLICABLE"
    code = "MARKET_PRICE_NOT_REQUIRED"
    message = "Market-data intake is intentionally suppressed by external-order policy."
  } else if (ready) {
    status = "PASS"
    code = "MARKET_PRICE_READY"
    message = "A valid fresh price is available from an accepted WebSocket event or initial seed."
  }
  return createMarketCheck({
    id: "market.price",
    status,
    code,
    message,
    expected: "A valid initial seed or accepted WebSocket price event within the existing market-data freshness window.",
    remediation: "Verify the configured market-data route and wait for a valid fresh WebSocket event or the existing initial-price seed.",
    observedAt,
    possibleCauses: ready ? [] : [
      "The exchange stream has not delivered a valid first price event.",
      "The configured symbol subscription may be invalid or interrupted.",
    ],
    details: {
      source,
      subscriptionAcknowledged: route.priceSubscriptionReady === true,
      websocketEventReceived: eventReceived,
      timestamp: isTimestamp(market.priceTimestamp) ? market.priceTimestamp : null,
      ageMs: ageMs({ observedAt, timestamp: market.priceTimestamp }),
      freshnessThresholdMs: price.freshnessThresholdMs ?? null,
      fresh: market.priceFresh === true,
    },
  })
}

function createMarketBookCheck({ market, input, routeRequired, bookRequired, observedAt } = {}) {
  const route = input.route ?? {}
  const book = input.book ?? {}
  const ready = route.bookSubscriptionReady === true &&
    book.eventReceived === true &&
    market.bookFresh === true &&
    isTimestamp(market.bookTimestamp)
  let status = "BLOCKED"
  let code = "MARKET_BOOK_NOT_READY"
  let message = "The required order-book stream has no accepted fresh first event."
  if (!routeRequired || !bookRequired) {
    status = "NOT_APPLICABLE"
    code = "MARKET_BOOK_NOT_REQUIRED"
    message = "The configured market/order path does not require order-book data."
  } else if (ready) {
    status = "PASS"
    code = "MARKET_BOOK_READY"
    message = "A fresh accepted order-book event is available for this market."
  }
  return createMarketCheck({
    id: "market.book",
    status,
    code,
    message,
    expected: "A required order-book subscription and accepted first event within the existing 5-second market-data freshness window.",
    remediation: "Verify the book subscription and wait for a valid first book event; acknowledgement alone is not sufficient.",
    observedAt,
    possibleCauses: ready ? [] : [
      "The exchange stream has not delivered a valid first book event.",
      "The configured book subscription may be invalid or interrupted.",
    ],
    details: {
      required: bookRequired,
      subscriptionAcknowledged: route.bookSubscriptionReady === true,
      firstEventReceived: book.eventReceived === true,
      timestamp: isTimestamp(market.bookTimestamp) ? market.bookTimestamp : null,
      ageMs: ageMs({ observedAt, timestamp: market.bookTimestamp }),
      freshnessThresholdMs: book.freshnessThresholdMs ?? null,
      fresh: market.bookFresh === true,
    },
  })
}

function createMarketMetadataCheck({ market, observedAt } = {}) {
  const ready = market.marketMetadataReady === true
  let status = "BLOCKED"
  let code = "MARKET_METADATA_NOT_READY"
  let message = "Required exchange market metadata is unavailable."
  if (ready) {
    status = "PASS"
    code = "MARKET_METADATA_READY"
    message = "Authoritative exchange market metadata is available."
  }
  return createMarketCheck({
    id: "market.metadata",
    status,
    code,
    message,
    expected: "Authoritative exchange market metadata and the configured order-type filters are available.",
    remediation: "Refresh authoritative market metadata and validate required order types and trading filters.",
    observedAt,
    details: {
      ready,
      orderType: market.orderType ?? null,
    },
  })
}

function getVolatilitySnapshotStatus(snapshot) {
  if (snapshot?.ok !== true) {
    return null
  }
  return snapshot.data?.status ?? null
}

function isVolatilityProtectionReady({ market, snapshotStatus } = {}) {
  const historyReady = Number.isSafeInteger(snapshotStatus?.historyCount) &&
    Number.isSafeInteger(snapshotStatus?.requiredHistoryCount) &&
    snapshotStatus.historyCount >= snapshotStatus.requiredHistoryCount
  const protectionInitialized = market.volatilityProtection !== null &&
    typeof market.volatilityProtection === "object"
  return snapshotStatus?.isReady === true &&
    snapshotStatus.isFresh === true &&
    Array.isArray(snapshotStatus.blockers) &&
    snapshotStatus.blockers.length === 0 &&
    historyReady &&
    protectionInitialized
}

function getVolatilityPossibleCauses({ snapshot, snapshotStatus } = {}) {
  const possibleCauses = []
  if (snapshot?.ok !== true) {
    possibleCauses.push("The candle-history service did not provide a usable snapshot.")
  } else if (Array.isArray(snapshotStatus?.blockers)) {
    possibleCauses.push(...snapshotStatus.blockers)
  }
  return possibleCauses
}

function createVolatilityDetails({ market, snapshotStatus, observedAt } = {}) {
  return {
    enabled: true,
    isReady: snapshotStatus?.isReady === true,
    isFresh: snapshotStatus?.isFresh === true,
    subscriptionReady: snapshotStatus?.subscriptionReady === true,
    historyCount: Number.isSafeInteger(snapshotStatus?.historyCount) ? snapshotStatus.historyCount : null,
    requiredHistoryCount: Number.isSafeInteger(snapshotStatus?.requiredHistoryCount)
      ? snapshotStatus.requiredHistoryCount
      : null,
    lastEventAt: isTimestamp(snapshotStatus?.lastEventAt) ? snapshotStatus.lastEventAt : null,
    lastEventAgeMs: ageMs({ observedAt, timestamp: snapshotStatus?.lastEventAt }),
    freshnessThresholdMs: snapshotStatus?.freshnessThresholdMs ?? null,
    reason: snapshotStatus?.reason ?? null,
    blockers: Array.isArray(snapshotStatus?.blockers) ? snapshotStatus.blockers : [],
    protectionMode: market.volatilityProtection?.mode ?? null,
  }
}

function createMarketVolatilityCheck({ market, input, observedAt } = {}) {
  const volatility = input.volatility ?? {}
  if (volatility.enabled !== true) {
    return createMarketCheck({
      id: "market.volatility",
      status: "NOT_APPLICABLE",
      code: "VOLATILITY_PROTECTION_DISABLED",
      message: "Volatility protection is disabled for this market.",
      expected: "Volatility protection is either disabled by configuration or fully initialized.",
      remediation: "No volatility action is required for a market with protection explicitly disabled.",
      observedAt,
      details: {
        enabled: false,
      },
    })
  }
  const snapshot = volatility.snapshot
  const snapshotStatus = getVolatilitySnapshotStatus(snapshot)
  const ready = isVolatilityProtectionReady({ market, snapshotStatus })
  let status = "BLOCKED"
  let code = "VOLATILITY_PROTECTION_NOT_READY"
  let message = "Required candle history or live volatility protection is unavailable, stale or incomplete."
  if (ready) {
    status = "PASS"
    code = "VOLATILITY_PROTECTION_READY"
    message = "Required candle history and live volatility inputs are fresh; engine protection is initialized."
  }
  return createMarketCheck({
    id: "market.volatility",
    status,
    code,
    message,
    expected: "Required candle history is complete and the live 1-minute candle event is fresh within the service-owned threshold.",
    remediation: "Restore the configured candle-history route, obtain complete history and a fresh live candle event, then verify engine protection initialization.",
    observedAt,
    possibleCauses: getVolatilityPossibleCauses({ snapshot, snapshotStatus }),
    details: createVolatilityDetails({ market, snapshotStatus, observedAt }),
  })
}
function createMarketEngineSafetyCheck({ market, engineBlockers, observedAt } = {}) {
  let status = "PASS"
  let code = "MARKET_ENGINE_SAFETY_CLEAR"
  let message = "No additional engine market blockers are active."
  if (engineBlockers.length > 0) {
    status = "BLOCKED"
    code = "MARKET_ENGINE_BLOCKERS_ACTIVE"
    message = "The existing engine reports market-local or global submission blockers."
  }
  return createMarketCheck({
    id: "market.engine-safety",
    status,
    code,
    message,
    expected: "No active engine strategy, ownership, pause, account or submission blockers for this market.",
    remediation: "Resolve the reported market's existing strategy, ownership, pause or submission blockers using the approved operator workflow.",
    observedAt,
    details: {
      symbol: market.symbol,
      blockers: engineBlockers,
    },
  })
}

function createMarketReadiness({ market, input = {}, runtime, observedAt } = {}) {
  if (market.enabled !== true) {
    return freezeValue(createDisabledMarketReport({ market, observedAt }))
  }
  const routeRequired = input.route?.required !== false
  const bookRequired = getBookRequired({ market, input, runtime })
  const engineBlockers = Array.isArray(market.blockers) ? [...market.blockers] : []
  if (runtime.tradingEnabled === true &&
      runtime.userData?.ready !== true &&
      runtime.startupBoundary !== true &&
      !engineBlockers.includes("USER_DATA_NOT_READY")) {
    engineBlockers.push("USER_DATA_NOT_READY")
  }
  const checks = [
    createMarketRouteCheck({ market, input, routeRequired, bookRequired, observedAt }),
    createMarketPriceCheck({ market, input, routeRequired, observedAt }),
    createMarketBookCheck({ market, input, routeRequired, bookRequired, observedAt }),
    createMarketMetadataCheck({ market, observedAt }),
    createMarketVolatilityCheck({ market, input, observedAt }),
    createMarketEngineSafetyCheck({ market, engineBlockers, observedAt }),
  ]
  const checkBlockers = checks
    .filter((check) => check.status === "BLOCKED")
    .map((check) => check.code)
  const blockers = [...new Set([...checkBlockers, ...engineBlockers])]
  const warnings = []
  if (input.unownedOrderObserved === true && input.externalOrdersPolicy === "IGNORE") {
    warnings.push("EXTERNAL_ORDERS_IGNORED_BY_POLICY")
  }
  let readiness = "READY"
  if (runtime.tradingEnabled !== true) {
    readiness = "OBSERVATION_ONLY"
  } else if (blockers.length > 0) {
    readiness = "BLOCKED"
  }
  return freezeValue({
    symbol: market.symbol,
    enabled: true,
    readiness,
    blockers,
    warnings,
    checks,
  })
}

function resolveReportStatus({ runtime, runtimeBlockers, enabledMarkets, readyMarkets, blockedMarkets, warnings } = {}) {
  if (runtimeBlockers.length > 0) {
    return "BLOCKED"
  }
  if (runtime.tradingEnabled !== true) {
    return "OBSERVATION_ONLY"
  }
  if (enabledMarkets.length === 0 || readyMarkets.length === 0) {
    return "BLOCKED"
  }
  if (blockedMarkets.length > 0 || warnings.length > 0) {
    return "DEGRADED"
  }
  return "HEALTHY"
}

function createReportSummary({ runtimeChecks, marketReports, runtimeBlockers, blockedMarkets, readyMarkets, warnings } = {}) {
  const marketChecks = marketReports.flatMap((market) => market.checks)
  const allChecks = [...runtimeChecks, ...marketChecks]
  const passed = allChecks.filter((check) => check.status === "PASS").length
  const skipped = allChecks.filter((check) => check.status === "NOT_APPLICABLE").length
  const enabledMarkets = marketReports.filter((market) => market.enabled)
  return {
    passed,
    warnings: warnings.length,
    blocked: runtimeBlockers.length + blockedMarkets.length,
    skipped,
    configuredMarkets: marketReports.length,
    enabledMarkets: enabledMarkets.length,
    readyMarkets: readyMarkets.length,
    blockedMarkets: blockedMarkets.length,
  }
}

/**
 * Build an immutable, read-only startup readiness projection from authoritative runtime snapshots.
 *
 * The report never mutates the engine, authorizes trading, restores process state or performs
 * broker operations. The existing user-data readiness flag and per-market engine submission
 * guards remain the only trading admission controls.
 *
 * @param {object} options
 * @param {object} options.runtime - Current Harvester process/runtime snapshot.
 * @param {Array<object>} options.markets - Current engine market snapshots.
 * @param {object} options.readinessInputs - Bootstrap-owned snapshots from existing services.
 * @param {number} [options.observedAt] - Observation time in epoch milliseconds.
 * @returns {Readonly<object>} Immutable global and per-market readiness report.
 */
function createRuntimeReadinessChecks({ runtime, readinessInputs, marketCount, observedAt } = {}) {
  const checks = createRuntimeChecks({
    runtime,
    inputs: readinessInputs,
    observedAt,
  })
  const enabledMarkets = readinessInputs.configuration?.enabledMarkets
  const configuredMarketsExist = Array.isArray(enabledMarkets) && enabledMarkets.length > 0
  const snapshotsMissing = readinessInputs.marketSnapshotAvailable === false ||
    (configuredMarketsExist && marketCount === 0)
  if (snapshotsMissing) {
    checks.push(createEngineSnapshotCheck({ readinessInputs, observedAt }))
  }
  if (readinessInputs.startupFailure) {
    checks.push(createStartupFailureCheck({
      startupFailure: readinessInputs.startupFailure,
      observedAt,
    }))
  }
  return checks
}

function createMarketReports({ markets, readinessInputs, runtime, observedAt } = {}) {
  if (!Array.isArray(markets)) {
    return []
  }
  const marketInputs = readinessInputs.markets ?? {}
  return markets.map((market) => createMarketReadiness({
    market,
    input: marketInputs[market.symbol] ?? {},
    runtime,
    observedAt,
  }))
}

function createReportFacts({ runtimeChecks, marketReports } = {}) {
  const runtimeBlockers = runtimeChecks
    .filter((check) => check.status === "BLOCKED" && check.blocksTrading)
    .map((check) => check.code)
  const runtimeWarnings = runtimeChecks
    .filter((check) => check.status === "WARNING")
    .map((check) => check.code)
  const enabledMarkets = marketReports.filter((market) => market.enabled)
  const blockedMarkets = enabledMarkets.filter((market) => market.readiness === "BLOCKED")
  const readyMarkets = enabledMarkets.filter((market) => market.readiness === "READY")
  const marketWarnings = marketReports.flatMap((market) => market.warnings)
  return {
    runtimeBlockers,
    enabledMarkets,
    blockedMarkets,
    readyMarkets,
    warnings: [...runtimeWarnings, ...marketWarnings],
  }
}

/**
 * Build an immutable, read-only startup readiness projection from authoritative runtime snapshots.
 *
 * The report never mutates the engine, authorizes trading, restores process state or performs
 * broker operations. The existing user-data readiness flag and per-market engine submission
 * guards remain the only trading admission controls.
 *
 * @param {object} options
 * @param {object} options.runtime - Current Harvester process/runtime snapshot.
 * @param {Array<object>} options.markets - Current engine market snapshots.
 * @param {object} options.readinessInputs - Bootstrap-owned snapshots from existing services.
 * @param {number} [options.observedAt] - Observation time in epoch milliseconds.
 * @returns {Readonly<object>} Immutable global and per-market readiness report.
 */
export function createHarvesterReadinessReport({
  runtime = {},
  markets = [],
  readinessInputs = {},
  observedAt = runtime.observedAt ?? Date.now(),
} = {}) {
  const normalizedMarkets = Array.isArray(markets) ? markets : []
  const runtimeChecks = createRuntimeReadinessChecks({
    runtime,
    readinessInputs,
    marketCount: normalizedMarkets.length,
    observedAt,
  })
  const marketReports = createMarketReports({
    markets: normalizedMarkets,
    readinessInputs,
    runtime,
    observedAt,
  })
  const facts = createReportFacts({ runtimeChecks, marketReports })
  const status = resolveReportStatus({
    runtime,
    runtimeBlockers: facts.runtimeBlockers,
    enabledMarkets: facts.enabledMarkets,
    readyMarkets: facts.readyMarkets,
    blockedMarkets: facts.blockedMarkets,
    warnings: facts.warnings,
  })
  const summary = createReportSummary({
    runtimeChecks,
    marketReports,
    runtimeBlockers: facts.runtimeBlockers,
    blockedMarkets: facts.blockedMarkets,
    readyMarkets: facts.readyMarkets,
    warnings: facts.warnings,
  })
  const marketBlockers = facts.blockedMarkets.map((market) => ({
    symbol: market.symbol,
    blockers: market.blockers,
  }))
  return freezeValue({
    observedAt,
    status,
    tradingEnabled: runtime.tradingEnabled === true,
    tradingGateOpen: runtime.userData?.ready === true,
    authorizationGrantedByReport: false,
    restorationEnabled: readinessInputs.processContinuity?.restorationEnabled === true,
    checks: runtimeChecks,
    markets: marketReports,
    runtimeBlockers: facts.runtimeBlockers,
    marketBlockers,
    blockers: facts.runtimeBlockers,
    warnings: facts.warnings,
    summary,
  })
}
