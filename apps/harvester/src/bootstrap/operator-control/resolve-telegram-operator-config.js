export class TelegramUserIdConfigurationError extends Error {
  constructor(...args) {
    const [message, code, cause] = args
    super(message, { cause })
    this.name = "TelegramUserIdConfigurationError"
    this.code = code
  }
}

const isCanonicalTelegramUserId = (value) =>
  typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))

function assertAppConfig({ appConfig }) {
  if (appConfig === null || typeof appConfig !== "object" || Array.isArray(appConfig)) {
    throw new TelegramUserIdConfigurationError(
      "Cannot resolve Telegram operator config: appConfig must be an object",
      "TELEGRAM_OPERATOR_CONFIG_INVALID",
    )
  }
}

function validateConfiguredUserIds({ configuredIds }) {
  if (!Array.isArray(configuredIds)) {
    throw new TelegramUserIdConfigurationError(
      "Invalid app config at operatorControl.telegram.allowedUserIds: expected an array of canonical positive decimal Telegram user IDs",
      "TELEGRAM_OPERATOR_ALLOWLIST_INVALID",
    )
  }
  for (const [index, id] of configuredIds.entries()) {
    if (!isCanonicalTelegramUserId(id)) {
      throw new TelegramUserIdConfigurationError(
        `Invalid app config at operatorControl.telegram.allowedUserIds[${index}]: expected a canonical positive decimal Telegram user ID string`,
        "TELEGRAM_OPERATOR_ALLOWLIST_INVALID",
      )
    }
  }
  if (new Set(configuredIds).size !== configuredIds.length) {
    throw new TelegramUserIdConfigurationError(
      "Invalid app config at operatorControl.telegram.allowedUserIds: duplicate Telegram user IDs are not allowed",
      "TELEGRAM_OPERATOR_ALLOWLIST_DUPLICATE",
    )
  }
}

function validateEnvironmentUserId({ environmentUserId }) {
  if (environmentUserId !== undefined &&
      environmentUserId !== "" &&
      !isCanonicalTelegramUserId(environmentUserId)) {
    throw new TelegramUserIdConfigurationError(
      "Invalid TELEGRAM_USER_ID: expected a canonical positive decimal Telegram sender user ID (digits only, no spaces or leading zeroes, within the safe integer range)",
      "TELEGRAM_USER_ID_INVALID",
    )
  }
}

function resolveAllowedUserIds({ configuredIds, environmentUserId }) {
  if (environmentUserId === undefined || environmentUserId === "") {
    return [...configuredIds]
  }
  return [...new Set([...configuredIds, environmentUserId])]
}

function assertEnabledAllowlist({ telegram, allowedUserIds }) {
  if (telegram.enabled === true && allowedUserIds.length === 0) {
    throw new TelegramUserIdConfigurationError(
      "Telegram operator control is enabled but operatorControl.telegram.allowedUserIds is empty; set TELEGRAM_USER_ID or configure a trusted user ID",
      "TELEGRAM_OPERATOR_ALLOWLIST_REQUIRED",
    )
  }
}

/** Resolve and validate the private-chat Telegram sender allowlist before adapter startup. */
export function resolveTelegramOperatorConfig({ appConfig, env = process.env } = {}) {
  assertAppConfig({ appConfig })
  const environmentUserId = env?.TELEGRAM_USER_ID
  if (appConfig.operatorControl === undefined &&
      (environmentUserId === undefined || environmentUserId === "")) {
    return appConfig
  }

  const operatorControl = appConfig.operatorControl ?? {}
  const telegram = operatorControl.telegram ?? { enabled: false, allowedUserIds: [] }
  const configuredIds = telegram.allowedUserIds
  validateConfiguredUserIds({ configuredIds })
  validateEnvironmentUserId({ environmentUserId })

  const allowedUserIds = resolveAllowedUserIds({ configuredIds, environmentUserId })
  assertEnabledAllowlist({ telegram, allowedUserIds })

  return {
    ...appConfig,
    operatorControl: {
      ...operatorControl,
      telegram: {
        ...telegram,
        allowedUserIds,
      },
    },
  }
}
