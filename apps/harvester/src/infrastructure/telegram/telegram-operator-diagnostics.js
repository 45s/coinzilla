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
  let sanitized = String(value)
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
    const value = readProperty({
      value: context,
      key,
    })
    if (typeof value === "string" && value.length > 0) {
      normalized[key] = sanitizeText({
        value,
        botToken,
      })
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function readErrorProperties({ error, botToken }) {
  const name = readProperty({
    value: error,
    key: "name",
  })
  const code = readProperty({
    value: error,
    key: "code",
  })
  const message = readProperty({
    value: error,
    key: "message",
  })
  const stack = readProperty({
    value: error,
    key: "stack",
  })
  const cause = readProperty({
    value: error,
    key: "cause",
  })
  const errors = readProperty({
    value: error,
    key: "errors",
  })
  const context = normalizeSafeContext({
    context: readProperty({
      value: error,
      key: "context",
    }),
    botToken,
  })
  return {
    name,
    code,
    message,
    stack,
    cause,
    errors,
    context,
  }
}

function describeNestedCause({ cause, botToken, seen, depth }) {
  if (cause === undefined) {
    return {}
  }
  return {
    cause: describeErrorValue({
      error: cause,
      botToken,
      seen,
      depth: depth + 1,
    }),
  }
}

function describeNestedErrors({ errors, botToken, seen, depth }) {
  if (!Array.isArray(errors)) {
    return {}
  }
  return {
    errors: errors.map(nestedError =>
      describeErrorValue({
        error: nestedError,
        botToken,
        seen,
        depth: depth + 1,
      }),
    ),
  }
}

function buildErrorDetails({ properties, error, botToken, seen, depth }) {
  return {
    name: typeof properties.name === "string"
      ? sanitizeText({
          value: properties.name,
          botToken,
        })
      : "Error",
    ...(typeof properties.code === "string" || typeof properties.code === "number"
      ? {
          code: String(properties.code),
        }
      : {}),
    message: sanitizeText({
      value: typeof properties.message === "string" ? properties.message : String(error),
      botToken,
    }),
    ...(typeof properties.stack === "string"
      ? {
          stack: sanitizeText({
            value: properties.stack,
            botToken,
          }),
        }
      : {}),
    ...(properties.context
      ? {
          context: properties.context,
        }
      : {}),
    ...describeNestedCause({
      cause: properties.cause,
      botToken,
      seen,
      depth,
    }),
    ...describeNestedErrors({
      errors: properties.errors,
      botToken,
      seen,
      depth,
    }),
  }
}

function describeErrorValue({ error, botToken, seen, depth }) {
  if (error === null || error === undefined) {
    return {
      message: String(error),
    }
  }
  if (typeof error !== "object") {
    return {
      message: sanitizeText({
        value: error,
        botToken,
      }),
    }
  }
  if (seen.has(error)) {
    return {
      message: "[Circular error cause]",
    }
  }
  if (depth >= 5) {
    return {
      message: "[Error cause depth limit reached]",
    }
  }
  seen.add(error)
  const properties = readErrorProperties({
    error,
    botToken,
  })
  const details = buildErrorDetails({
    properties,
    error,
    botToken,
    seen,
    depth,
  })
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

function createTelegramDiagnosticLogger({ logger }) {
  return ({ interaction, message, level = "debug", fields = {} } = {}) => {
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
            ...(interaction.symbol
              ? {
                  symbol: interaction.symbol,
                }
              : {}),
            ...(interaction.operation
              ? {
                  operation: interaction.operation,
                }
              : {}),
            ...(typeof stage === "string"
              ? {
                  stage,
                }
              : {}),
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
}

function createTelegramDiagnosticFailure({ log, botToken }) {
  return ({ interaction, error, stage, operation, symbol, level = "error" } = {}) => {
    if (!markFailure({
      interaction,
      error,
    })) {
      return false
    }
    const details = describeError({
      error,
      botToken,
    })
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
}

function createTelegramDiagnosticReporter({ log, botToken }) {
  return ({ interaction, stage, operation, symbol, classification, message, level = "error" } = {}) => {
    const reportKey = `report:${stage ?? "UNKNOWN"}:${operation ?? ""}:${symbol ?? ""}:${classification ?? "UNCLASSIFIED"}`
    if (interaction?.loggedErrors instanceof Set && interaction.loggedErrors.has(reportKey)) {
      return false
    }
    if (interaction?.loggedErrors instanceof Set) {
      interaction.loggedErrors.add(reportKey)
    }
    if (interaction) {
      interaction.failed = true
    }
    log({
      interaction,
      message: "Telegram interaction FAILED",
      level,
      fields: {
        stage: stage ?? interaction?.stage ?? "UNKNOWN",
        failureClassification: classification ?? "UNCLASSIFIED",
        ...(operation ? { operation } : {}),
        ...(symbol ? { symbol } : {}),
        ...(message
          ? {
              errorMessage: sanitizeText({
                value: message,
                botToken,
              }),
            }
          : {}),
      },
    })
    return true
  }
}

/**
 * Creates safe, correlated diagnostic operations for the inbound Telegram adapter.
 *
 * @param {{logger?: object, botToken?: string}} [options]
 * @returns {{log: Function, fail: Function, report: Function, describeError: Function}}
 */
export function createTelegramOperatorDiagnostics({ logger, botToken } = {}) {
  const log = createTelegramDiagnosticLogger({ logger })
  const fail = createTelegramDiagnosticFailure({
    log,
    botToken,
  })
  const report = createTelegramDiagnosticReporter({
    log,
    botToken,
  })
  return Object.freeze({
    log,
    fail,
    report,
    describeError: error => describeError({
      error,
      botToken,
    }),
  })
}
