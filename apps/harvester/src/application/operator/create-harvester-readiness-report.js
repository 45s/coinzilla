const UNSAFE_USER_DATA_STATUSES = new Set([
  "CONNECTIONCLOSED",
  "RECOVERING",
  "RECOVERYFAILED",
  "TERMINATED",
  "RPCERROR",
  "EXECUTIONNORMALIZATIONFAILED",
  "INVALID_EVENT",
  "EXECUTION_ACCOUNTING_FAILED",
])

function freezeValue(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeValue))
  }
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeValue(entry)]),
    ))
  }
  return value
}

function createCheck({
  id,
  scope,
  status,
  code,
  message,
  remediation,
  details = {},
  blocksTrading = status === "BLOCKED",
}) {
  return freezeValue({
    id,
    scope,
    status,
    code,
    message,
    remediation,
    blocksTrading,
    details,
  })
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function ageMs(observedAt, timestamp) {
  return isTimestamp(observedAt) && isTimestamp(timestamp)
    ? Math.max(0, observedAt - timestamp)
    : null
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

function identitiesMatch(expected, actual) {
  if (!expected || !actual) {
    return false
  }
  for (const field of ["providerInstanceId", "providerType", "environment", "accountId"]) {
    if (expected[field] !== undefined && expected[field] !== null &&
        expected[field] !== actual[field]) {
      return false
    }
  }
  return ["providerInstanceId", "providerType", "environment"].every((field) =>
    typeof actual[field] === "string" && actual[field].length > 0)
}

function createRuntimeChecks({ runtime, inputs, observedAt }) {
  const configuration = inputs.configuration ?? {}
  const broker = inputs.broker ?? {}
  const account = inputs.account ?? {}
  const userData = inputs.userData ?? {}
  const continuity = inputs.processContinuity ?? {}
  const preflight = account.preflight ?? {}
  const openOrders = account.openOrders ?? {}
  const unsafeStatus = UNSAFE_USER_DATA_STATUSES.has(
    String(userData.status ?? runtime.userData?.status ?? "").replaceAll(/[^a-zA-Z_]/g, "").toUpperCase(),
  )
  const reconciliationRequired = userData.requiresReconciliation === true ||
    (userData.status === "AUTHORITATIVE_RECONCILIATION_REQUIRED" && userData.preflightComplete !== true)
  const unsafeUserData = userData.accountingFailed === true ||
    userData.streamUnsafe === true ||
    reconciliationRequired ||
    userData.pendingRecovery === true ||
    userData.safetyHaltRequired === true ||
    userData.retryableRecoveryFailure === true ||
    unsafeStatus
  const externalOrderOnly = openOrders.unownedSymbols?.length > 0 &&
    openOrders.blockReasons?.length > 0 &&
    openOrders.blockReasons.every((reason) => String(reason).startsWith("UNOWNED_OPEN_ORDERS"))

  const checks = [
    createCheck({
      id: "runtime.lifecycle",
      scope: "RUNTIME",
      status: runtime.stopping === true || ["STOPPING", "STOPPED"].includes(runtime.runtimeState)
        ? "BLOCKED"
        : runtime.runtimeState === "RUNNING" || runtime.startupBoundary === true
          ? "PASS"
          : "BLOCKED",
      code: runtime.stopping === true ? "RUNTIME_STOPPING" : "RUNTIME_STATE_UNKNOWN",
      message: runtime.stopping === true
        ? "Harvester is stopping; trading activation is prohibited."
        : "Harvester startup lifecycle is active.",
      remediation: "Wait for a clean startup or inspect the original lifecycle failure.",
      details: { runtimeState: runtime.runtimeState, stopping: runtime.stopping === true },
    }),
    createCheck({
      id: "configuration.validation",
      scope: "RUNTIME",
      status: configuration.validated === true && Array.isArray(configuration.enabledMarkets)
        ? "PASS"
        : "BLOCKED",
      code: "CONFIGURATION_NOT_VALIDATED",
      message: configuration.validated === true
        ? "Effective runtime configuration and enabled market selection were validated."
        : "Required configuration validation evidence is unavailable.",
      remediation: "Correct the named configuration path and restart Harvester; secret values are intentionally omitted.",
      details: {
        enabledMarketCount: Array.isArray(configuration.enabledMarkets)
          ? configuration.enabledMarkets.length
          : null,
      },
    }),
    createCheck({
      id: "broker.connection",
      scope: "ACCOUNT",
      status: broker.connected === true ? "PASS" : "BLOCKED",
      code: "BROKER_NOT_CONNECTED",
      message: broker.connected === true
        ? "The selected execution broker connection was established."
        : "The execution broker connection is not confirmed.",
      remediation: "Verify broker connectivity and inspect the original sanitized connection error.",
      details: { connected: broker.connected === true, identity: safeIdentity(broker.identity) },
    }),
    createCheck({
      id: "broker.capabilities",
      scope: "ACCOUNT",
      status: broker.capabilities?.validated === true &&
        Array.isArray(broker.capabilities.missing) &&
        broker.capabilities.missing.length === 0
        ? "PASS"
        : "BLOCKED",
      code: "BROKER_CAPABILITIES_INCOMPLETE",
      message: broker.capabilities?.validated === true &&
        Array.isArray(broker.capabilities.missing) &&
        broker.capabilities.missing.length === 0
        ? "The required BrokerPort method surface is available."
        : "One or more required BrokerPort capabilities are missing or could not be verified.",
      remediation: "Use an adapter implementing the required BrokerPort methods for the enabled strategies and data feeds.",
      details: {
        required: Array.isArray(broker.capabilities?.required) ? broker.capabilities.required : [],
        missing: Array.isArray(broker.capabilities?.missing) ? broker.capabilities.missing : null,
        validationScope: "BrokerPort method surface only; exchange account permissions are not inferred.",
      },
    }),
    createCheck({
      id: "process.restoration",
      scope: "ACCOUNT",
      status: continuity.storeConfigured !== true
        ? "NOT_APPLICABLE"
        : continuity.previousProcessStarted === true && continuity.restorationEnabled !== true
          ? "BLOCKED"
          : continuity.previousProcessStarted === false
            ? "NOT_APPLICABLE"
            : "BLOCKED",
      code: continuity.storeConfigured !== true
        ? "PROCESS_CONTINUITY_STORE_NOT_CONFIGURED"
        : continuity.previousProcessStarted === true
          ? "PROCESS_RESTART_RESTORATION_DISABLED"
          : continuity.previousProcessStarted === false
            ? "NO_PRIOR_PROCESS_SESSION"
            : "PROCESS_CONTINUITY_UNKNOWN",
      message: continuity.storeConfigured !== true
        ? "No durable process-continuity store is configured; prior-process history is unknown and restoration is not attempted."
        : continuity.previousProcessStarted === true && continuity.restorationEnabled !== true
          ? "A prior process session was detected. Runtime restoration remains disabled and trading stays observation-only."
          : continuity.previousProcessStarted === false
            ? "The verified process ledger contains no prior process session."
            : "The verified process ledger did not provide a definitive prior-process result.",
      remediation: continuity.previousProcessStarted === true
        ? "Follow the approved restart/reconciliation procedure; this report never restores prior trading state."
        : "No restoration action is available or required from this readiness report.",
      details: {
        storeConfigured: continuity.storeConfigured === true,
        previousProcessStarted: continuity.storeConfigured === true
          ? continuity.previousProcessStarted ?? null
          : null,
        restorationEnabled: continuity.restorationEnabled === true,
      },
    }),
    createCheck({
      id: "account.preflight",
      scope: "ACCOUNT",
      status: preflight.completed === true && preflight.durable === true &&
        isTimestamp(preflight.sourceTime) && Number.isSafeInteger(preflight.balanceCount)
        ? "PASS"
        : "BLOCKED",
      code: "ACCOUNT_PREFLIGHT_INCOMPLETE",
      message: preflight.completed === true && preflight.durable === true
        ? "The account PREFLIGHT snapshot completed its existing durability barrier."
        : "The required account PREFLIGHT snapshot or durability barrier is incomplete.",
      remediation: "Inspect account snapshot retrieval, lifecycle-event publication and the existing Journal PREFLIGHT flush barrier.",
      details: {
        completed: preflight.completed === true,
        durable: preflight.durable === true,
        sourceTime: isTimestamp(preflight.sourceTime) ? preflight.sourceTime : null,
        ageMs: ageMs(observedAt, preflight.sourceTime),
        balanceCount: Number.isSafeInteger(preflight.balanceCount) ? preflight.balanceCount : null,
      },
    }),
    createCheck({
      id: "account.open-orders",
      scope: "ACCOUNT",
      status: openOrders.completed === true && openOrders.durable === true &&
        isTimestamp(openOrders.observedAt) && Number.isSafeInteger(openOrders.orderCount)
        ? externalOrderOnly ? "WARNING" : openOrders.blockReasons?.length > 0 ? "BLOCKED" : "PASS"
        : "BLOCKED",
      code: externalOrderOnly
        ? "UNOWNED_EXTERNAL_ORDERS_OBSERVED"
        : openOrders.completed !== true || openOrders.durable !== true
          ? "ACCOUNT_OPEN_ORDERS_AUDIT_INCOMPLETE"
          : openOrders.blockReasons?.[0] ?? "ACCOUNT_OPEN_ORDERS_UNRESOLVED",
      message: externalOrderOnly
        ? "The account-wide snapshot contains unowned external orders; ownership remains external and per-market policy determines impact."
        : openOrders.completed === true && openOrders.durable === true && openOrders.blockReasons?.length === 0
          ? "The account-wide open-order PREFLIGHT audit completed and was durably recorded."
          : "The account-wide open-order audit is incomplete or contains an unresolved non-external-order condition.",
      remediation: externalOrderOnly
        ? "Review the affected symbols and their configured externalOrdersPolicy; do not adopt, cancel or modify these orders automatically."
        : "Complete the approved account-wide open-order audit and resolve any non-external-order reconciliation blockers.",
      details: {
        completed: openOrders.completed === true,
        durable: openOrders.durable === true,
        phase: openOrders.phase ?? null,
        observedAt: isTimestamp(openOrders.observedAt) ? openOrders.observedAt : null,
        ageMs: ageMs(observedAt, openOrders.observedAt),
        orderCount: Number.isSafeInteger(openOrders.orderCount) ? openOrders.orderCount : null,
        unownedSymbols: Array.isArray(openOrders.unownedSymbols) ? openOrders.unownedSymbols : [],
        blockReasons: Array.isArray(openOrders.blockReasons) ? openOrders.blockReasons : [],
      },
      blocksTrading: !externalOrderOnly && (openOrders.completed !== true ||
        openOrders.durable !== true || (openOrders.blockReasons?.length ?? 0) > 0),
    }),
    createCheck({
      id: "user-data.reconciliation",
      scope: "ACCOUNT",
      status: userData.subscriptionEstablished === true &&
        userData.preflightComplete === true &&
        !unsafeUserData &&
        (runtime.tradingEnabled !== true || runtime.userData?.ready === true ||
          runtime.startupBoundary === true)
        ? "PASS"
        : "BLOCKED",
      code: unsafeUserData
        ? reconciliationRequired ? "AUTHORITATIVE_RECONCILIATION_REQUIRED" : "USER_DATA_RECONCILIATION_UNSAFE"
        : runtime.tradingEnabled === true && runtime.userData?.ready !== true && runtime.startupBoundary !== true
          ? "USER_DATA_NOT_READY"
          : "USER_DATA_PREFLIGHT_INCOMPLETE",
      message: unsafeUserData
        ? "User-data synchronization or accounting state is unsafe."
        : userData.preflightComplete === true && userData.subscriptionEstablished === true
          ? "User-data subscription, account PREFLIGHT and queued-event reconciliation are complete."
          : "User-data subscription or required PREFLIGHT reconciliation evidence is incomplete.",
      remediation: "Restore user-data delivery, complete authoritative account/open-order reconciliation, and verify the event queue is drained before activation.",
      details: {
        subscriptionEstablished: userData.subscriptionEstablished === true,
        preflightComplete: userData.preflightComplete === true,
        ready: runtime.userData?.ready === true,
        activationPending: runtime.startupBoundary === true && runtime.userData?.ready !== true,
        status: userData.status ?? runtime.userData?.status ?? "UNKNOWN",
        requiresReconciliation: userData.requiresReconciliation === true,
        accountingFailed: userData.accountingFailed === true,
        streamUnsafe: userData.streamUnsafe === true,
        pendingRecovery: userData.pendingRecovery === true,
        safetyHaltRequired: userData.safetyHaltRequired === true,
        retryableRecoveryFailure: userData.retryableRecoveryFailure === true,
        lastStatusEventAt: isTimestamp(userData.lastStatusEventAt)
          ? userData.lastStatusEventAt
          : runtime.userData?.lastEventAt ?? null,
        lastStatusEventAgeMs: ageMs(observedAt, userData.lastStatusEventAt ?? runtime.userData?.lastEventAt),
      },
    }),
  ]
  return checks
}

function createMarketCheck({ id, status, code, message, remediation, details = {} }) {
  return createCheck({
    id,
    scope: "MARKET",
    status,
    code,
    message,
    remediation,
    details,
  })
}

function createMarketReadiness({ market, input = {}, runtime, observedAt }) {
  const symbol = market.symbol
  const checks = []
  const blockers = []
  const warnings = []
  if (market.enabled !== true) {
    return freezeValue({
      symbol,
      enabled: false,
      readiness: "DISABLED",
      blockers: ["MARKET_DISABLED"],
      warnings,
      checks: [
        createMarketCheck({
          id: "market.configuration",
          status: "NOT_APPLICABLE",
          code: "MARKET_DISABLED",
          message: "The market is disabled by effective runtime configuration.",
          remediation: "Enable the market explicitly if it should participate in this runtime.",
        }),
      ],
    })
  }

  const route = input.route ?? {}
  const expectedIdentity = route.expected
  const priceIdentity = route.priceSourceIdentity ?? route.actual
  const bookIdentity = route.bookSourceIdentity ?? route.actual
  const bookRequired = runtime.tradingEnabled === true &&
    (input.book?.required ?? market.bookRequired ?? market.orderType !== "LIMIT")
  const routeRequired = input.route?.required !== false
  const routeMatches = !routeRequired || (
    identitiesMatch(expectedIdentity, priceIdentity) &&
    route.priceSubscriptionReady === true &&
    (!bookRequired || (
      identitiesMatch(expectedIdentity, bookIdentity) &&
      route.bookSubscriptionReady === true
    ))
  )
  const routeStatus = routeRequired ? routeMatches ? "PASS" : "BLOCKED" : "NOT_APPLICABLE"
  checks.push(createMarketCheck({
    id: "market.route",
    status: routeStatus,
    code: routeStatus === "BLOCKED"
      ? "MARKET_DATA_ROUTE_NOT_VERIFIED"
      : routeStatus === "NOT_APPLICABLE"
        ? "MARKET_DATA_ROUTE_NOT_REQUIRED"
        : "MARKET_DATA_ROUTE_VERIFIED",
    message: routeStatus === "BLOCKED"
      ? "Market-data subscription or provider/account/environment identity is missing or mismatched."
      : routeStatus === "PASS"
        ? "Market-data price and required book streams use the configured provider route."
        : "Market-data subscription is intentionally suppressed by the configured external-order policy.",
    remediation: "Verify the per-symbol market-data provider instance, provider type, environment and account identity; do not silently fall back to another provider.",
    details: {
      expected: safeIdentity(expectedIdentity),
      actualPriceSource: safeIdentity(priceIdentity),
      actualBookSource: bookRequired ? safeIdentity(bookIdentity) : null,
      priceSubscriptionReady: route.priceSubscriptionReady === true,
      bookSubscriptionReady: route.bookSubscriptionReady === true,
      required: routeRequired,
    },
  }))

  const priceInput = input.price ?? {}
  const priceSource = priceInput.source ?? "UNKNOWN"
  const priceReady = market.priceFresh === true &&
    isTimestamp(market.priceTimestamp) &&
    route.priceSubscriptionReady === true &&
    (priceSource === "WEBSOCKET" && priceInput.websocketEventReceived === true ||
      priceSource === "INITIAL_SEED")
  const priceStatus = !routeRequired ? "NOT_APPLICABLE" : priceReady ? "PASS" : "BLOCKED"
  checks.push(createMarketCheck({
    id: "market.price",
    status: priceStatus,
    code: priceStatus === "NOT_APPLICABLE"
      ? "MARKET_PRICE_NOT_REQUIRED"
      : priceReady ? "MARKET_PRICE_READY" : "MARKET_PRICE_NOT_READY",
    message: priceStatus === "NOT_APPLICABLE"
      ? "Market-data intake is intentionally suppressed by the configured external-order policy."
      : priceReady
        ? "A valid fresh price is available from the initial seed or an accepted WebSocket event."
        : "No valid fresh market price is confirmed; a subscription acknowledgement alone is insufficient.",
    remediation: "Verify the configured market-data route and wait for a valid fresh WebSocket event or the existing initial-price seed.",
    details: {
      source: priceSource,
      subscriptionAcknowledged: route.priceSubscriptionReady === true,
      websocketEventReceived: priceInput.websocketEventReceived === true,
      timestamp: isTimestamp(market.priceTimestamp) ? market.priceTimestamp : null,
      ageMs: ageMs(observedAt, market.priceTimestamp),
      fresh: market.priceFresh === true,
    },
  }))

  const bookInput = input.book ?? {}
  const bookReady = !bookRequired || (
    route.bookSubscriptionReady === true &&
    bookInput.eventReceived === true &&
    market.bookFresh === true &&
    isTimestamp(market.bookTimestamp)
  )
  const bookStatus = !routeRequired || !bookRequired ? "NOT_APPLICABLE" : bookReady ? "PASS" : "BLOCKED"
  checks.push(createMarketCheck({
    id: "market.book",
    status: bookStatus,
    code: bookStatus === "BLOCKED" ? "MARKET_BOOK_NOT_READY" : bookStatus === "PASS" ? "MARKET_BOOK_READY" : "MARKET_BOOK_NOT_REQUIRED",
    message: bookStatus === "BLOCKED"
      ? "The required order-book stream has no accepted fresh first event."
      : bookStatus === "PASS"
        ? "A fresh accepted order-book event is available for this market."
        : "The configured order path does not require order-book data.",
    remediation: "Verify the book subscription and wait for a valid first book event; a subscription acknowledgement is not sufficient.",
    details: {
      required: bookRequired,
      subscriptionAcknowledged: route.bookSubscriptionReady === true,
      firstEventReceived: bookInput.eventReceived === true,
      timestamp: isTimestamp(market.bookTimestamp) ? market.bookTimestamp : null,
      ageMs: ageMs(observedAt, market.bookTimestamp),
      fresh: market.bookFresh === true,
    },
  }))

  const metadataReady = market.marketMetadataReady === true
  checks.push(createMarketCheck({
    id: "market.metadata",
    status: metadataReady ? "PASS" : "BLOCKED",
    code: metadataReady ? "MARKET_METADATA_READY" : "MARKET_METADATA_NOT_READY",
    message: metadataReady
      ? "Authoritative exchange market metadata is available."
      : "Required exchange market metadata is unavailable.",
    remediation: "Refresh authoritative market metadata and validate the required order type and trading filters.",
    details: {
      ready: metadataReady,
      orderType: market.orderType ?? null,
    },
  }))

  const volatility = input.volatility ?? {}
  let volatilityStatus = "NOT_APPLICABLE"
  let volatilityCode = "VOLATILITY_PROTECTION_DISABLED"
  let volatilityMessage = "Volatility protection is disabled for this market."
  let volatilityDetails = { enabled: false }
  if (volatility.enabled === true) {
    const snapshot = volatility.snapshot
    const status = snapshot?.ok === true ? snapshot.data?.status : null
    const ready = status?.isReady === true &&
      status.isFresh === true &&
      Array.isArray(status.blockers) &&
      status.blockers.length === 0 &&
      Number.isSafeInteger(status.historyCount) &&
      Number.isSafeInteger(status.requiredHistoryCount) &&
      status.historyCount >= status.requiredHistoryCount &&
      market.volatilityProtection !== null
    volatilityStatus = ready ? "PASS" : "BLOCKED"
    volatilityCode = ready ? "VOLATILITY_PROTECTION_READY" : "VOLATILITY_PROTECTION_NOT_READY"
    volatilityMessage = ready
      ? "Required candle history and live volatility inputs are fresh; engine protection is initialized."
      : "Required candle history or live volatility protection is unavailable, stale or incomplete."
    volatilityDetails = {
      enabled: true,
      isReady: status?.isReady === true,
      isFresh: status?.isFresh === true,
      subscriptionReady: status?.subscriptionReady === true,
      historyCount: Number.isSafeInteger(status?.historyCount) ? status.historyCount : null,
      requiredHistoryCount: Number.isSafeInteger(status?.requiredHistoryCount) ? status.requiredHistoryCount : null,
      lastEventAt: isTimestamp(status?.lastEventAt) ? status.lastEventAt : null,
      lastEventAgeMs: ageMs(observedAt, status?.lastEventAt),
      reason: status?.reason ?? null,
      blockers: Array.isArray(status?.blockers) ? status.blockers : [],
      protectionMode: market.volatilityProtection?.mode ?? null,
    }
  }
  checks.push(createMarketCheck({
    id: "market.volatility",
    status: volatilityStatus,
    code: volatilityCode,
    message: volatilityMessage,
    remediation: "Restore the configured candle-history route, obtain the required complete history and a fresh live candle event, then verify engine protection initialization.",
    details: volatilityDetails,
  }))

  const ignoredExternalOrder = input.unownedOrderObserved === true &&
    input.externalOrdersPolicy === "IGNORE"
  if (ignoredExternalOrder) {
    warnings.push("EXTERNAL_ORDERS_IGNORED_BY_POLICY")
  }
  const engineBlockers = Array.isArray(market.blockers) ? [...market.blockers] : []
  const startupBoundary = runtime.startupBoundary === true
  const globalUserDataBlocker = runtime.tradingEnabled === true &&
    runtime.userData?.ready !== true &&
    !startupBoundary
  if (globalUserDataBlocker && !engineBlockers.includes("USER_DATA_NOT_READY")) {
    engineBlockers.push("USER_DATA_NOT_READY")
  }
  const generatedBlockingChecks = checks.filter(({ status }) => status === "BLOCKED")
  for (const check of generatedBlockingChecks) {
    blockers.push(check.code)
  }
  for (const blocker of engineBlockers) {
    if (!blockers.includes(blocker)) {
      blockers.push(blocker)
    }
  }
  const engineSafetyStatus = engineBlockers.length > 0 ? "BLOCKED" : "PASS"
  checks.push(createMarketCheck({
    id: "market.engine-safety",
    status: engineSafetyStatus,
    code: engineSafetyStatus === "BLOCKED" ? "MARKET_ENGINE_BLOCKERS_ACTIVE" : "MARKET_ENGINE_SAFETY_CLEAR",
    message: engineSafetyStatus === "BLOCKED"
      ? "The existing engine reports one or more market-local or global submission blockers."
      : "No additional engine market blockers are active.",
    remediation: "Resolve only the reported market's existing strategy, ownership, pause or submission blockers using the approved operator workflow.",
    details: { blockers: engineBlockers },
  }))
  if (engineSafetyStatus === "BLOCKED" && engineBlockers.length > 0) {
    for (const blocker of engineBlockers) {
      if (!blockers.includes(blocker)) {
        blockers.push(blocker)
      }
    }
  }
  const readiness = runtime.tradingEnabled !== true
    ? "OBSERVATION_ONLY"
    : blockers.length > 0 || checks.some(({ status }) => status === "BLOCKED")
      ? "BLOCKED"
      : "READY"
  return freezeValue({
    symbol,
    enabled: true,
    readiness,
    blockers,
    warnings,
    checks,
  })
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
  const runtimeChecks = createRuntimeChecks({ runtime, inputs: readinessInputs, observedAt })
  if (readinessInputs.marketSnapshotAvailable === false ||
      (Array.isArray(readinessInputs.configuration?.enabledMarkets) &&
       readinessInputs.configuration.enabledMarkets.length > 0 && markets.length === 0)) {
    runtimeChecks.push(createCheck({
      id: "engine.market-snapshots",
      scope: "RUNTIME",
      status: "BLOCKED",
      code: "ENGINE_MARKET_SNAPSHOT_UNAVAILABLE",
      message: "The engine did not provide the configured per-market readiness snapshots.",
      remediation: "Inspect engine startup and market snapshot diagnostics; trading activation remains closed.",
      details: { configuredMarketCount: readinessInputs.configuration?.enabledMarkets?.length ?? null },
    }))
  }
  if (readinessInputs.startupFailure) {
    runtimeChecks.push(createCheck({
      id: "startup.failure",
      scope: "RUNTIME",
      status: "BLOCKED",
      code: readinessInputs.startupFailure.code ?? "HARVESTER_STARTUP_FAILED",
      message: `The ${readinessInputs.startupFailure.component ?? "startup"} stage failed before readiness could be established.`,
      remediation: "Resolve the original startup failure shown in the preceding Harvester diagnostic and retry startup.",
      details: { component: readinessInputs.startupFailure.component ?? "UNKNOWN" },
    }))
  }
  const runtimeBlockers = runtimeChecks
    .filter(({ status, blocksTrading }) => status === "BLOCKED" && blocksTrading)
    .map(({ code }) => code)
  const runtimeWarnings = runtimeChecks
    .filter(({ status }) => status === "WARNING")
    .map(({ code }) => code)
  const marketInputs = readinessInputs.markets ?? {}
  const marketReports = Array.isArray(markets)
    ? markets.map((market) => createMarketReadiness({
      market,
      input: marketInputs[market.symbol] ?? {},
      runtime,
      observedAt,
    }))
    : []
  const enabledMarkets = marketReports.filter(({ enabled }) => enabled)
  const blockedMarkets = enabledMarkets.filter(({ readiness }) => readiness === "BLOCKED")
  const readyMarkets = enabledMarkets.filter(({ readiness }) => readiness === "READY")
  const marketWarnings = marketReports.flatMap(({ warnings }) => warnings)
  const warningCount = runtimeWarnings.length + marketWarnings.length +
    runtimeChecks.filter(({ status }) => status === "WARNING").length
  let status = "HEALTHY"
  if (runtimeBlockers.length > 0) {
    status = "BLOCKED"
  } else if (runtime.tradingEnabled !== true) {
    status = "OBSERVATION_ONLY"
  } else if (enabledMarkets.length === 0 || readyMarkets.length === 0) {
    status = "BLOCKED"
  } else if (blockedMarkets.length > 0 || warningCount > 0) {
    status = "DEGRADED"
  }
  const blockers = runtimeBlockers
  const warnings = [...runtimeWarnings, ...marketWarnings]
  return freezeValue({
    observedAt,
    status,
    tradingEnabled: runtime.tradingEnabled === true,
    tradingGateOpen: runtime.userData?.ready === true,
    authorizationGrantedByReport: false,
    restorationEnabled: readinessInputs.processContinuity?.restorationEnabled === true,
    checks: runtimeChecks,
    markets: marketReports,
    runtimeBlockers: blockers,
    marketBlockers: marketReports
      .filter(({ readiness }) => readiness === "BLOCKED")
      .map(({ symbol, blockers: marketCodes }) => ({ symbol, blockers: marketCodes })),
    blockers,
    warnings,
    summary: {
      passed: runtimeChecks.filter(({ status: checkStatus }) => checkStatus === "PASS").length +
        marketReports.reduce((count, market) => count + market.checks.filter(({ status: checkStatus }) => checkStatus === "PASS").length, 0),
      warnings: warnings.length,
      blocked: runtimeBlockers.length + blockedMarkets.length,
      skipped: runtimeChecks.filter(({ status: checkStatus }) => checkStatus === "NOT_APPLICABLE").length +
        marketReports.reduce((count, market) => count + market.checks.filter(({ status: checkStatus }) => checkStatus === "NOT_APPLICABLE").length, 0),
      configuredMarkets: marketReports.length,
      enabledMarkets: enabledMarkets.length,
      readyMarkets: readyMarkets.length,
      blockedMarkets: blockedMarkets.length,
    },
  })
}
