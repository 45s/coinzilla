const LEGACY_INSTANCE_ID = "binancePrimary"

const LEGACY_CONFIGURATION = Object.freeze({
  instances: Object.freeze({
    [LEGACY_INSTANCE_ID]: Object.freeze({
      provider: "binance",
      accountId: "binance-primary",
    }),
  }),
  selection: Object.freeze({
    execution: LEGACY_INSTANCE_ID,
    account: LEGACY_INSTANCE_ID,
    marketData: LEGACY_INSTANCE_ID,
  }),
})

function assertRecord({ value, path }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Harvester provider configuration "${path}" must be an object`)
  }
}

function assertProviderInstanceId({ id }) {
  if (typeof id !== "string" || !/^[a-z][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new TypeError("Harvester provider instance IDs must be stable identifiers")
  }
}

function assertCredentialEnvironment({ credentialEnv, id }) {
  if (credentialEnv === undefined) {
    return
  }
  assertRecord({
    value: credentialEnv,
    path: `brokers.instances.${id}.credentialEnv`,
  })
  for (const name of Object.values(credentialEnv)) {
    if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new TypeError(`Provider instance "${id}" credential references must be environment variable names`)
    }
  }
}

function resolveProviderInstance({ id, definition, tradingMode }) {
  assertProviderInstanceId({
    id,
  })
  assertRecord({
    value: definition,
    path: `brokers.instances.${id}`,
  })
  const allowedKeys = ["provider", "accountId", "credentialEnv"]
  for (const key of Object.keys(definition)) {
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`Provider instance "${id}" contains unsupported configuration field "${key}"`)
    }
  }
  if (typeof definition.provider !== "string" || !/^[a-z][a-z0-9-]*$/.test(definition.provider)) {
    throw new TypeError(`Provider instance "${id}" requires a provider type`)
  }
  if (typeof definition.accountId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(definition.accountId) || definition.accountId.length > 64) {
    throw new TypeError(`Provider instance "${id}" requires a stable non-secret account ID`)
  }
  assertCredentialEnvironment({
    credentialEnv: definition.credentialEnv,
    id,
  })
  return Object.freeze({
    id,
    provider: definition.provider,
    accountId: definition.accountId,
    ...(definition.credentialEnv
      ? { credentialEnv: Object.freeze({ ...definition.credentialEnv }) }
      : {}),
    ...(tradingMode ? { tradingMode } : {}),
  })
}

function resolveProviderInstances({ instances, tradingMode }) {
  const resolved = []
  for (const [id, definition] of Object.entries(instances)) {
    resolved.push(resolveProviderInstance({
      id,
      definition,
      tradingMode,
    }))
  }
  if (resolved.length === 0) {
    throw new TypeError("Harvester provider configuration must contain at least one instance")
  }
  const accountIds = new Set()
  for (const instance of resolved) {
    if (accountIds.has(instance.accountId)) {
      throw new TypeError(`Harvester provider account ID "${instance.accountId}" must be unique`)
    }
    accountIds.add(instance.accountId)
  }
  return Object.freeze(resolved)
}

function resolveProviderSelections({ selection, instances }) {
  assertRecord({
    value: selection,
    path: "brokers.selection",
  })
  const allowedRoles = ["execution", "account", "marketData"]
  for (const key of Object.keys(selection)) {
    if (!allowedRoles.includes(key)) {
      throw new TypeError(`Harvester provider selection "${key}" is unsupported`)
    }
  }
  const selections = {}
  for (const role of allowedRoles) {
    const instanceId = selection[role]
    if (typeof instanceId !== "string" || !instances.some((instance) => instance.id === instanceId)) {
      throw new TypeError(`Harvester ${role} selection must reference a configured provider instance`)
    }
    selections[role] = instanceId
  }
  if (new Set(Object.values(selections)).size !== 1) {
    throw new TypeError("This Harvester migration phase requires execution, account, and market data to select the same provider instance")
  }
  return Object.freeze(selections)
}

/**
 * Resolve named provider instances. Old configuration is mapped at this single
 * compatibility boundary; explicit selections never fall back to Binance.
 */
export function resolveProviderConfiguration({ brokers, tradingMode } = {}) {
  const configuration = brokers ?? LEGACY_CONFIGURATION
  for (const key of Object.keys(configuration)) {
    if (key !== "instances" && key !== "selection") {
      throw new TypeError(`Harvester provider configuration field "${key}" is unsupported`)
    }
  }
  assertRecord({
    value: configuration,
    path: "brokers",
  })
  assertRecord({
    value: configuration.instances,
    path: "brokers.instances",
  })
  const instances = resolveProviderInstances({
    instances: configuration.instances,
    tradingMode,
  })
  const selections = resolveProviderSelections({
    selection: configuration.selection,
    instances,
  })
  return Object.freeze({
    instances,
    selections,
    legacyCompatibility: brokers === undefined,
  })
}
