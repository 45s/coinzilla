import test from "node:test"
import assert from "node:assert/strict"
import { BROKER_PORT_METHODS } from "../ports/broker.port.js"
import { createProviderRegistry } from "./provider-registry.js"

const testCase = (...args) => test(`[provider-registry.test.js] ${args[0]}`, ...args.slice(1))

const createCapabilities = ({ provider = "binance", selectedMode = "testnet" } = {}) => Object.freeze({
  contractVersion: 1,
  provider,
  product: "spot",
  environment: Object.freeze({ selectedMode }),
})

function createBroker({ capabilities, onConnect, onDisconnect } = {}) {
  const calls = []
  const broker = Object.fromEntries(BROKER_PORT_METHODS.map((method) => {
    if (method === "connect") {
      return [method, async () => {
        calls.push("connect")
        await onConnect?.()
      }]
    }
    if (method === "disconnect") {
      return [method, async () => {
        calls.push("disconnect")
        await onDisconnect?.()
      }]
    }
    return [method, async () => {
      calls.push(method)
      return undefined
    }]
  }))
  Object.defineProperty(broker, "capabilities", {
    value: capabilities ?? createCapabilities(),
    enumerable: true,
    configurable: true,
  })
  return {
    broker,
    calls,
  }
}

function createProvider({
  providerInstanceId = "binanceTestnet",
  providerType = "binance",
  accountId = "binance-primary",
  environment = "testnet",
  broker,
} = {}) {
  const capabilities = createCapabilities({
    provider: providerType,
    selectedMode: environment,
  })
  const providerBroker = broker ?? createBroker({ capabilities }).broker
  return {
    providerInstanceId,
    providerType,
    accountId,
    environment,
    broker: providerBroker,
  }
}

testCase("registers distinct named instances of the same provider type without selecting a default", () => {
  const testnetProvider = createProvider()
  const liveProvider = createProvider({
    providerInstanceId: "binanceLive",
    accountId: "binance-live-account",
    environment: "live",
  })
  const registry = createProviderRegistry({ providers: [testnetProvider, liveProvider] })

  assert.deepEqual(registry.list().map(({ providerInstanceId }) => providerInstanceId), [
    "binanceTestnet",
    "binanceLive",
  ], "The registry must retain both explicit Binance instance identities in registration order.")
  assert.equal(registry.get("binanceTestnet").environment, "testnet",
    "The TESTNET instance must retain its own environment identity.")
  assert.equal(registry.get("binanceLive").environment, "live",
    "A second Binance instance must retain its separate LIVE environment identity.")
  assert.equal(typeof registry.get, "function",
    "Consumers must resolve a provider by an explicit instance ID rather than an implicit default.")
})

testCase("rejects an empty provider registry and duplicate provider-instance identities", () => {
  assert.throws(
    () => createProviderRegistry({ providers: [] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "A registry without an explicitly configured provider instance must fail closed.",
  )
  assert.throws(
    () => createProviderRegistry({
      providers: [createProvider(), createProvider()],
    }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "Duplicate provider-instance IDs must be rejected rather than overwriting an existing account connection.",
  )
})

testCase("rejects malformed identities and capability declarations that disagree with provider identity", () => {
  const malformedProvider = createProvider({ providerInstanceId: "binance testnet" })
  assert.throws(
    () => createProviderRegistry({ providers: [malformedProvider] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "Provider-instance IDs must be stable identifier tokens without whitespace.",
  )
  const mismatchedProvider = createProvider({
    broker: createBroker({
      capabilities: createCapabilities({
        provider: "other",
        selectedMode: "testnet",
      }),
    }).broker,
  })
  assert.throws(
    () => createProviderRegistry({ providers: [mismatchedProvider] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "A provider capability declaration must identify the same provider type as its registry entry.",
  )
})

testCase("returns immutable provider metadata without exposing broker internals", () => {
  const provider = createProvider()
  const registry = createProviderRegistry({ providers: [provider] })
  const resolved = registry.get("binanceTestnet")
  const listed = registry.list()

  assert.equal(resolved.providerInstanceId, "binanceTestnet",
    "Explicit lookup must return the exact requested provider instance.")
  assert.equal(resolved.providerType, "binance",
    "Provider metadata must distinguish the implementation type from its instance identity.")
  assert.equal(resolved.accountId, "binance-primary",
    "The stable non-secret account alias must be available for account-scoped composition.")
  assert.equal(resolved.capabilities, provider.broker.capabilities,
    "The registry must expose the immutable capability declaration supplied by the broker adapter.")
  assert.equal(Object.isFrozen(resolved), true,
    "A registered provider descriptor must not be mutable by its consumers.")
  assert.equal(Object.isFrozen(listed), true,
    "The provider listing must be an immutable snapshot.")
  assert.equal(Object.hasOwn(listed[0], "broker"), false,
    "The metadata listing must not expose live broker objects or credential-bearing internals.")
})

testCase("rejects unknown provider-instance lookup instead of falling back to another provider", () => {
  const registry = createProviderRegistry({ providers: [createProvider()] })

  assert.throws(
    () => registry.get("missingProvider"),
    (error) => error.code === "HARVESTER_PROVIDER_INSTANCE_NOT_FOUND",
    "An unknown provider-instance ID must fail explicitly instead of selecting the only registered provider.")
})

testCase("serializes concurrent connection requests and performs one successful disconnect", async () => {
  let resolveConnection
  const connectionGate = new Promise((resolve) => { resolveConnection = resolve })
  const { broker, calls } = createBroker({ onConnect: () => connectionGate })
  const registry = createProviderRegistry({ providers: [createProvider({ broker })] })
  const firstConnection = registry.connect("binanceTestnet")
  const secondConnection = registry.connect("binanceTestnet")

  assert.deepEqual(calls, ["connect"],
    "Concurrent startup requests for one provider instance must share one underlying connection attempt.")
  resolveConnection()
  await Promise.all([firstConnection, secondConnection])
  assert.equal(registry.get("binanceTestnet").status, "connected",
    "The provider lifecycle must become connected only after the broker connection succeeds.")

  await Promise.all([
    registry.disconnect("binanceTestnet"),
    registry.disconnect("binanceTestnet"),
  ])
  assert.deepEqual(calls, ["connect", "disconnect"],
    "Concurrent cleanup requests must share one underlying disconnect attempt.")
  assert.equal(registry.get("binanceTestnet").status, "disconnected",
    "The registry must expose the completed disconnected lifecycle state.")
})

testCase("allows cleanup after a failed connection and preserves the original connection error", async () => {
  const connectionError = new Error("Binance connection failed")
  const { broker, calls } = createBroker({
    onConnect: async () => { throw connectionError },
  })
  const registry = createProviderRegistry({ providers: [createProvider({ broker })] })

  await assert.rejects(
    registry.connect("binanceTestnet"),
    (error) => error === connectionError,
    "The registry must preserve the original broker connection error without wrapping away its identity.")
  await registry.disconnect("binanceTestnet")

  assert.deepEqual(calls, ["connect", "disconnect"],
    "A failed provider connection must still allow deterministic disconnect cleanup.")
  assert.equal(registry.get("binanceTestnet").status, "disconnected",
    "Successful cleanup after a connection failure must close the provider lifecycle.")
})

testCase("retries a failed disconnect cleanup without repeating a successful disconnect", async () => {
  const disconnectError = new Error("Binance disconnect failed")
  let disconnectAttempts = 0
  const { broker, calls } = createBroker({
    onDisconnect: async () => {
      disconnectAttempts += 1
      if (disconnectAttempts === 1) {
        throw disconnectError
      }
    },
  })
  const registry = createProviderRegistry({ providers: [createProvider({ broker })] })

  await assert.rejects(
    registry.disconnect("binanceTestnet"),
    (error) => error === disconnectError,
    "The registry must preserve the original cleanup failure so shutdown can report it.")
  assert.equal(registry.get("binanceTestnet").status, "disconnect-failed",
    "A failed disconnect must remain visible instead of being reported as a successful cleanup.")
  await registry.disconnect("binanceTestnet")
  await registry.disconnect("binanceTestnet")

  assert.deepEqual(calls, ["disconnect", "disconnect"],
    "A failed cleanup may be retried, but a successful disconnect must be idempotent.")
  assert.equal(registry.get("binanceTestnet").status, "disconnected",
    "A later successful cleanup must clear the prior disconnect-failed state.")
})


testCase("waits for an in-flight connection before performing one concurrent disconnect", async () => {
  let resolveConnection
  const connectionGate = new Promise((resolve) => { resolveConnection = resolve })
  const { broker, calls } = createBroker({ onConnect: () => connectionGate })
  const registry = createProviderRegistry({ providers: [createProvider({ broker })] })
  const connection = registry.connect("binanceTestnet")
  const firstDisconnect = registry.disconnect("binanceTestnet")
  const secondDisconnect = registry.disconnect("binanceTestnet")

  resolveConnection()
  await Promise.all([connection, firstDisconnect, secondDisconnect])

  assert.deepEqual(calls, ["connect", "disconnect"],
    "Concurrent cleanup requested during connection must wait for startup and invoke the underlying disconnect exactly once.")
  assert.equal(registry.get("binanceTestnet").status, "disconnected",
    "The provider must reach a stable disconnected state after cleanup races with connection.")
})


testCase("rolls back every constructed provider in reverse order after a later connection fails", async () => {
  const calls = []
  const connectionError = new Error("second Binance instance failed to connect")
  const createTrackedProvider = ({ suffix, failConnect = false } = {}) => {
    const { broker } = createBroker({
      onConnect: async () => {
        calls.push(`connect:${suffix}`)
        if (failConnect) {
          throw connectionError
        }
      },
      onDisconnect: async () => calls.push(`disconnect:${suffix}`),
    })
    return createProvider({
      providerInstanceId: `binance${suffix}`,
      accountId: `account-${suffix}`,
      broker,
    })
  }
  const registry = createProviderRegistry({
    providers: [
      createTrackedProvider({ suffix: "First" }),
      createTrackedProvider({
        suffix: "Second",
        failConnect: true,
      }),
      createTrackedProvider({ suffix: "Third" }),
    ],
  })

  await assert.rejects(
    registry.connectAll(),
    (error) => error === connectionError,
    "The first provider connection error must remain primary when rollback succeeds.")
  assert.deepEqual(calls, [
    "connect:First",
    "connect:Second",
    "disconnect:Third",
    "disconnect:Second",
    "disconnect:First",
  ], "Partial connection failure must clean every constructed provider exactly once in reverse construction order.")
  assert.deepEqual(registry.list().map(({ status }) => status), [
    "disconnected",
    "disconnected",
    "disconnected",
  ], "All provider instances must be disconnected before registry startup rejects.")
})

testCase("disconnects all providers in reverse order and aggregates cleanup failures", async () => {
  const calls = []
  const cleanupError = new Error("first Binance instance cleanup failed")
  const createTrackedProvider = ({ suffix, failDisconnect = false } = {}) => {
    const { broker } = createBroker({
      onConnect: async () => calls.push(`connect:${suffix}`),
      onDisconnect: async () => {
        calls.push(`disconnect:${suffix}`)
        if (failDisconnect) {
          throw cleanupError
        }
      },
    })
    return createProvider({
      providerInstanceId: `binance${suffix}`,
      accountId: `account-${suffix}`,
      broker,
    })
  }
  const registry = createProviderRegistry({
    providers: [
      createTrackedProvider({
        suffix: "First",
        failDisconnect: true,
      }),
      createTrackedProvider({ suffix: "Second" }),
    ],
  })
  await registry.connectAll()

  await assert.rejects(
    registry.disconnectAll(),
    (error) => error instanceof AggregateError &&
      error.errors.length === 1 && error.errors[0] === cleanupError,
    "Cleanup must continue for every provider and preserve each failure.")
  assert.deepEqual(calls, [
    "connect:First",
    "connect:Second",
    "disconnect:Second",
    "disconnect:First",
  ], "Registry shutdown must disconnect providers in reverse construction order.")
})


testCase("rejects a provider instance without a versioned immutable capability declaration", () => {
  const { broker } = createBroker()
  delete broker.capabilities

  assert.throws(
    () => createProviderRegistry({ providers: [createProvider({ broker })] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "A broker without the existing capability contract must not be registered by method-presence inference.",
  )
})

testCase("rejects a capability snapshot for a different provider environment", () => {
  const { broker } = createBroker({
    capabilities: createCapabilities({
      provider: "binance",
      selectedMode: "live",
    }),
  })
  const provider = createProvider({
    environment: "testnet",
    broker,
  })

  assert.throws(
    () => createProviderRegistry({ providers: [provider] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "The registered provider environment must agree with the capability snapshot's selected environment.",
  )
})


testCase("fails closed on an unsupported provider capability contract version", () => {
  const capabilities = Object.freeze({
    ...createCapabilities(),
    contractVersion: 2,
  })
  const { broker } = createBroker({ capabilities })

  assert.throws(
    () => createProviderRegistry({ providers: [createProvider({ broker })] }),
    (error) => error.code === "HARVESTER_PROVIDER_REGISTRY_INVALID",
    "The registry must require the capability contract version it explicitly understands.",
  )
})
