const SAFE_CONTEXT_FIELDS = Object.freeze(["component", "operation", "symbol", "stage", "reason", "category"])

function readProperty(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function sanitizeText(value, botToken) {
  if (typeof value !== "string") {
    return undefined
  }
  let sanitized = value
  if (typeof botToken === "string" && botToken.length > 0) {
    sanitized = sanitized.split(botToken).join("[REDACTED]")
  }
  return sanitized
    .replace(/\b(?:bot)?\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/((?:token|api[_-]?key|secret|signature|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
}

function normalizeSafeContext(context, botToken) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return undefined
  }
  const normalized = {}
  for (const key of SAFE_CONTEXT_FIELDS) {
    const value = readProperty(context, key)
    if (typeof value !== "string" || value.length === 0) {
      continue
    }
    normalized[key] = sanitizeText(value, botToken)
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function describeErrorValue({ error, botToken, seen, depth }) {
  if (error === null || error === undefined) {
    return { message: String(error) }
  }
  if (typeof error !== "object") {
    return { message: sanitizeText(String(error), botToken) }
  }
  if (seen.has(error)) {
    return { message: "[Circular error cause]" }
  }
  if (depth >= 5) {
    return { message: "[Error cause depth limit reached]" }
  }
  seen.add(error)
  const name = readProperty(error, "name")
  const code = readProperty(error, "code")
  const message = readProperty(error, "message")
  const stack = readProperty(error, "stack")
  const cause = readProperty(error, "cause")
  const nestedErrors = readProperty(error, "errors")
  const context = normalizeSafeContext(readProperty(error, "context"), botToken)
  const details = {
    name: typeof name === "string" ? sanitizeText(name, botToken) : "Error",
    ...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
    message: sanitizeText(typeof message === "string" ? message : String(error), botToken),
    ...(typeof stack === "string" ? { stack: sanitizeText(stack, botToken) } : {}),
    ...(context ? { context } : {}),
    ...(cause !== undefined
      ? { cause: describeErrorValue({ error: cause, botToken, seen, depth: depth + 1 }) }
      : {}),
    ...(Array.isArray(nestedErrors)
      ? { errors: nestedErrors.map((nestedError) => describeErrorValue({ error: nestedError, botToken, seen, depth: depth + 1 })) }
      : {}),
  }
  seen.delete(error)
  return details
}

/**
 * Build safe, correlated diagnostics for one Telegram update.
 * Telegram identities and update payloads are intentionally excluded.
 *
 * @param {{logger?: object, botToken?: string}} options
 * @returns {{log: Function, fail: Function, describeError: Function}}
 */
export function createTelegramOperatorDiagnostics({ logger, botToken } = {}) {
  const describeError = (error) => describeErrorValue({
    error,
    botToken,
    seen: new Set(),
    depth: 0,
  })

  const log = ({ interaction, message, level = "debug", fields = {} } = {}) => {
    const stage = fields.stage ?? interaction?.stage
    if (interaction && typeof stage === "string") {
      interaction.stage = stage
    }
    const entry = {
      message,
      component: "harvester.operator",
      ...(interaction ? {
        correlationId: interaction.correlationId,
        interactionType: interaction.interactionType,
        action: interaction.action,
        ...(interaction.symbol ? { symbol: interaction.symbol } : {}),
        ...(interaction.operation ? { operation: interaction.operation } : {}),
        ...(typeof stage === "string" ? { stage } : {}),
        applicationOperationInvoked: interaction.applicationOperationInvoked === true,
        applicationOperationCompleted: interaction.applicationOperationCompleted === true,
        stateChanged: interaction.stateChanged === true,
      } : {}),
      ...fields,
    }
    try {
      logger?.[level]?.(entry)
    } catch {
      // Diagnostics must never replace the original Telegram/application outcome.
    }
    return entry
  }

  const fail = ({ interaction, error, stage, operation, symbol, level = "error" } = {}) => {
    if (interaction?.loggedErrors instanceof Set && interaction.loggedErrors.has(error)) {
      return false
    }
    if (interaction?.loggedErrors instanceof Set) {
      interaction.loggedErrors.add(error)
    }
    if (interaction) {
      interaction.failed = true
    }
    const details = describeError(error)
    log({
      interaction,
      message: "Telegram interaction FAILED",
      level,
      fields: {
        stage: stage ?? interaction?.stage ?? "UNKNOWN",
        ...(operation ?? interaction?.operation ? { operation: operation ?? interaction.operation } : {}),
        ...(symbol ?? interaction?.symbol ? { symbol: symbol ?? interaction.symbol } : {}),
        failureClassification: details.code ?? details.name ?? "UNCLASSIFIED",
        errorName: details.name,
        ...(details.code ? { errorCode: details.code } : {}),
        errorMessage: details.message,
        ...(details.stack ? { errorStack: details.stack } : {}),
        ...(details.context ? { errorContext: details.context } : {}),
        ...(details.cause ? { errorCause: details.cause } : {}),
        ...(details.errors ? { errorErrors: details.errors } : {}),
      },
    })
    return true
  }

  return Object.freeze({ log, fail, describeError })
}
