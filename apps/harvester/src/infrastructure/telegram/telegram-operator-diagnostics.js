const SAFE_CONTEXT_FIELDS = Object.freeze([
  "component",
  "operation",
  "symbol",
  "stage",
  "reason",
  "category",
])

function readProperty({ value, key }) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function sanitizeText({ value, botToken }) {
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
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
}

function normalizeSafeContext({ context, botToken }) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return undefined
  }
  const normalized = {}
  for (const key of SAFE_CONTEXT_FIELDS) {
    const value = readProperty({ value: context, key })
    if (typeof value === "string" && value.length > 0) {
      normalized[key] = sanitizeText({ value, botToken })
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function describeErrorValue({ error, botToken, seen, depth }) {
  if (error === null || error === undefined) {
    return { message: String(error) }
  }
  if (typeof error !== "object") {
    return { message: sanitizeText({ value: String(error), botToken }) }
  }
  if (seen.has(error)) {
    return { message: "[Circular error cause]" }
  }
  if (depth >= 5) {
    return { message: "[Error cause depth limit reached]" }
  }

  seen.add(error)
  const name = readProperty({ value: error, key: "name" })
  const code = readProperty({ value: error, key: "code" })
  const message = readProperty({ value: error, key: "message" })
  const stack = readProperty({ value: error, key: "stack" })
  const cause = readProperty({ value: error, key: "cause" })
  const nestedErrors = readProperty({ value: error, key: "errors" })
  const context = normalizeSafeContext({
    context: readProperty({ value: error, key: "context" }),
    botToken,
  })
  const details = {
    name: typeof name === "string" ? sanitizeText({ value: name, botToken }) : "Error",
    ...(typeof code === "string" || typeof code === "number"
      ? { code: String(code) }
      : {}),
    message: sanitizeText({
      value: typeof message === "string" ? message : String(error),
      botToken,
    }),
    ...(typeof stack === "string"
      ? { stack: sanitizeText({ value: stack, botToken }) }
      : {}),
    ...(context ? { context } : {}),
    ...(cause !== undefined
      ? {
          cause: describeErrorValue({
            error: cause,
            botToken,
            seen,
            depth: depth + 1,
          }),
        }
      : {}),
    ...(Array.isArray(nestedErrors)
      ? {
          errors: nestedErrors.map((nestedError) =>
            describeErrorValue({
              error: nestedError,
              botToken,
              seen,
              depth: depth + 1,
            }),
          ),
        }
      : {}),
  }
  seen.delete(error)
  return details
}

function describeError({ error, botToken }) {
  return describeErrorValue({
    error,
    botToken,
    seen: new Set(),
    depth: 0,
  })
}

function markFailure({ interaction, error }) {
  if (interaction?.loggedErrors instanceof Set && interaction.loggedErrors.has(error)) {
    return false
  }
  if (interaction?.loggedErrors instanceof Set) {
    interaction.loggedErrors.add(error)
  }
  if (interaction) {
    interaction.failed = true
  }
  return true
}

function buildFailureFields({ details, stage, operation, symbol, interaction }) {
  const fields = {
    stage: stage ?? interaction?.stage ?? "UNKNOWN",
    failureClassification: details.code ?? details.name ?? "UNCLASSIFIED",
    errorName: details.name,
    errorMessage: details.message,
  }
  const resolvedOperation = operation ?? interaction?.operation
  const resolvedSymbol = symbol ?? interaction?.symbol
  if (resolvedOperation) {
    fields.operation = resolvedOperation
  }
  if (resolvedSymbol) {
    fields.symbol = resolvedSymbol
  }
  if (details.code) {
    fields.errorCode = details.code
  }
  if (details.stack) {
    fields.errorStack = details.stack
  }
  if (details.context) {
    fields.errorContext = details.context
  }
  if (details.cause) {
    fields.errorCause = details.cause
  }
  if (details.errors) {
    fields.errorErrors = details.errors
  }
  return fields
}

export function createTelegramOperatorDiagnostics({ logger, botToken } = {}) {
  const log = ({ interaction, message, level = "debug", fields = {} } = {}) => {
    const stage = fields.stage ?? interaction?.stage
    if (interaction && typeof stage === "string") {
      interaction.stage = stage
    }
    if (interaction && message === "Telegram interaction REJECTED") {
      interaction.rejected = true
    }
    const entry = {
      message,
      component: "harvester.operator",
      ...(interaction
        ? {
            correlationId: interaction.correlationId,
            interactionType: interaction.interactionType,
            action: interaction.action,
            ...(interaction.symbol ? { symbol: interaction.symbol } : {}),
            ...(interaction.operation ? { operation: interaction.operation } : {}),
            ...(typeof stage === "string" ? { stage } : {}),
            applicationOperationInvoked: interaction.applicationOperationInvoked === true,
            applicationOperationCompleted: interaction.applicationOperationCompleted === true,
            stateChanged: interaction.stateChanged === true,
          }
        : {}),
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
    if (!markFailure({ interaction, error })) {
      return false
    }
    const details = describeError({ error, botToken })
    log({
      interaction,
      message: "Telegram interaction FAILED",
      level,
      fields: buildFailureFields({
        details,
        stage,
        operation,
        symbol,
        interaction,
      }),
    })
    return true
  }

  return Object.freeze({
    log,
    fail,
    describeError: (error) => describeError({ error, botToken }),
  })
}
