import { SystemCustomError } from "@coinzilla/utils"
const TRADING_ENVIRONMENTS = Object.freeze({
  TESTNET: "testnet",
  LIVE: "live",
})
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DEFAULT_ACCOUNT_ID = "binance-primary"

export class ProviderIdentityConfigError extends SystemCustomError {
  constructor(...args) {
    const [message, options = {}] = args
    super(message, options)
  }
}

function invalidIdentity({ field, expectation }) {
  return new ProviderIdentityConfigError(
    `Invalid Binance provider identity configuration: ${expectation}`,
    {
      code: "HARVESTER_PROVIDER_IDENTITY_INVALID",
      context: { field },
    },
  )
}

function resolveIdentityLabel({ value, fallback, field }) {
  const identity = value ?? fallback
  if (typeof identity !== "string" || !IDENTIFIER_PATTERN.test(identity)) {
    throw invalidIdentity({
      field,
      expectation: `${field} must be a stable non-secret identifier`,
    })
  }
  return identity
}

/**
 * Resolve the legacy single-Binance configuration to an explicit provider-instance identity.
 *
 * @param {{tradingMode: "testnet" | "live", providerInstanceId?: string, accountId?: string}} input
 * @returns {Readonly<{providerType: "binance", providerInstanceId: string, accountId: string}>}
 */
export function resolveBinanceProviderIdentity({
  tradingMode,
  providerInstanceId,
  accountId,
} = {}) {
  if (
    tradingMode !== TRADING_ENVIRONMENTS.TESTNET &&
    tradingMode !== TRADING_ENVIRONMENTS.LIVE
  ) {
    throw invalidIdentity({
      field: "TRADING_MODE",
      expectation: 'TRADING_MODE must be "testnet" or "live"',
    })
  }

  const defaultProviderInstanceId = tradingMode === TRADING_ENVIRONMENTS.TESTNET
    ? "binanceTestnet"
    : "binanceLive"
  return Object.freeze({
    providerType: "binance",
    providerInstanceId: resolveIdentityLabel({
      value: providerInstanceId,
      fallback: defaultProviderInstanceId,
      field: "BINANCE_PROVIDER_INSTANCE_ID",
    }),
    accountId: resolveIdentityLabel({
      value: accountId,
      fallback: DEFAULT_ACCOUNT_ID,
      field: "BINANCE_ACCOUNT_ID",
    }),
  })
}
