const LEGACY_ID = "binancePrimary"
const LEGACY_CONFIG = Object.freeze({
  instances: Object.freeze({ [LEGACY_ID]: Object.freeze({ provider: "binance", accountId: "binance-primary" }) }),
  selection: Object.freeze({ execution: LEGACY_ID, account: LEGACY_ID, marketData: LEGACY_ID }),
})

export function resolveProviderConfiguration({ brokers, tradingMode } = {}) {
  const config = brokers ?? LEGACY_CONFIG
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      !config.instances || typeof config.instances !== "object" || Array.isArray(config.instances) ||
      !config.selection || typeof config.selection !== "object" || Array.isArray(config.selection)) {
    throw new TypeError("Harvester broker configuration must define named instances and explicit role selections")
  }
  const instances = Object.entries(config.instances).map(([id, definition]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || !definition ||
        typeof definition.provider !== "string" || !definition.provider.trim() ||
        typeof definition.accountId !== "string" || !definition.accountId.trim()) {
      throw new TypeError(`Harvester provider instance "${id}" has an invalid non-secret descriptor`)
    }
    return Object.freeze({
      id,
      provider: definition.provider,
      accountId: definition.accountId,
      ...(definition.provider === "binance" ? { tradingMode } : {}),
    })
  })
  if (instances.length === 0) {
    throw new TypeError("Harvester broker configuration must define at least one provider instance")
  }
  const selections = {
    execution: config.selection.execution,
    account: config.selection.account,
    marketData: config.selection.marketData,
  }
  for (const [role, instanceId] of Object.entries(selections)) {
    if (typeof instanceId !== "string" || !instances.some((instance) => instance.id === instanceId)) {
      throw new TypeError(`Harvester ${role} selection must reference a configured provider instance`)
    }
  }
  if (new Set(Object.values(selections)).size !== 1) {
    throw new TypeError("This Harvester migration phase requires execution, account, and market data to select the same provider instance")
  }
  return Object.freeze({
    instances: Object.freeze(instances),
    selections: Object.freeze(selections),
    legacyCompatibility: brokers === undefined,
  })
}
