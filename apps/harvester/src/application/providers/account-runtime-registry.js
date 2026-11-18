import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../../domain/orders/order-registry.js"

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TRADING_ENVIRONMENTS = new Set(["testnet", "live"])

function validateProviderIdentity({ provider } = {}) {
  if (provider === null || typeof provider !== "object" || Array.isArray(provider)) {
    throw new TypeError("Account runtime registry providers must be identity descriptors")
  }
  for (const field of ["providerInstanceId", "providerType", "accountId"]) {
    if (typeof provider[field] !== "string" || !IDENTIFIER_PATTERN.test(provider[field])) {
      throw new TypeError(`Account runtime registry ${field} must be a stable non-secret identifier`)
    }
  }
  if (!TRADING_ENVIRONMENTS.has(provider.environment)) {
    throw new TypeError('Account runtime registry environment must be "testnet" or "live"')
  }
  return Object.freeze({
    providerInstanceId: provider.providerInstanceId,
    providerType: provider.providerType,
    accountId: provider.accountId,
    environment: provider.environment,
  })
}

function createAccountScopeKey({ identity }) {
  return JSON.stringify([identity.providerType, identity.accountId, identity.environment])
}

function createAccountTradingState() {
  // These are in-process Conservative strategy ledgers and controls, not restart-recovery data.
  return Object.freeze({
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: OrderRegistry.empty(),
    journalFills: [],
    pausedMarkets: new Set(),
    durablePausedMarkets: new Set(),
    recoveryManagedPausedMarkets: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    replacementIntents: new Set(),
    trailingBuyRepriceIntents: new Set(),
    completedOrderClientIds: new Set(),
    trailingBuySymbols: new Set(),
    requiresExchangeReconciliation: false,
  })
}

function createAccountRuntime({ identity }) {
  return Object.freeze({
    identity,
    state: createAccountTradingState(),
    marketMetadata: new Map(),
  })
}

function addAccountRuntime({ provider, accounts, accountScopes }) {
  const identity = validateProviderIdentity({ provider })
  if (accounts.has(identity.providerInstanceId)) {
    throw new TypeError("Account runtime registry contains a duplicate providerInstanceId")
  }
  const accountScopeKey = createAccountScopeKey({ identity })
  if (accountScopes.has(accountScopeKey)) {
    throw new TypeError("Account runtime registry contains a duplicate provider account identity")
  }
  accountScopes.add(accountScopeKey)
  accounts.set(identity.providerInstanceId, createAccountRuntime({ identity }))
}

function createAccountRuntimes({ providers }) {
  const accounts = new Map()
  const accountScopes = new Set()
  for (const provider of providers) {
    addAccountRuntime({ provider, accounts, accountScopes })
  }
  return accounts
}

/**
 * Create independent in-memory trading state for each configured provider account.
 *
 * @param {{providers: Array<{providerInstanceId: string, providerType: string, accountId: string, environment: "testnet" | "live"}>}} input
 * @returns {{get: (providerInstanceId: string) => object, list: () => object[]}}
 */
export function createAccountRuntimeRegistry({ providers } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError("Account runtime registry requires at least one provider account")
  }
  const accounts = createAccountRuntimes({ providers })
  return Object.freeze({
    get: (providerInstanceId) => {
      const account = accounts.get(providerInstanceId)
      if (!account) {
        throw new TypeError("Requested provider account runtime is not registered")
      }
      return account
    },
    list: () => Object.freeze([...accounts.values()].map(({ identity }) => identity)),
  })
}
