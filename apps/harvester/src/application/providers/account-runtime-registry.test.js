import assert from "node:assert/strict"
import test from "node:test"
import { createAccountRuntimeRegistry, linkSharedAccountOrderRegistry } from "./account-runtime-registry.js"
import { createPortfolioWorkflow } from "../../use-cases/create-portfolio-workflow.js"
import { createRecoverySellerAccountingWorkflow } from "../../use-cases/create-recovery-seller-accounting-workflow.js"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../../domain/orders/order-registry.js"

const providers = [
  {
    providerInstanceId: "binance-testnet-one",
    providerType: "binance",
    accountId: "account-one",
    environment: "testnet",
  },
  {
    providerInstanceId: "binance-testnet-two",
    providerType: "binance",
    accountId: "account-two",
    environment: "testnet",
  },
]

test("creates independent in-memory trading state for each provider account", () => {
  const registry = createAccountRuntimeRegistry({ providers })
  const first = registry.get("binance-testnet-one")
  const second = registry.get("binance-testnet-two")

  assert.notEqual(first.state.portfolio, second.state.portfolio, "Accounts must not share Portfolio instances.")
  assert.notEqual(first.state.orderRegistry, second.state.orderRegistry, "Accounts must not share OrderRegistry instances.")
  assert.notEqual(first.state.recoveryLedgers, second.state.recoveryLedgers, "Strategy accounting ledgers must remain account-local.")
  assert.notEqual(first.state.recoverySellerBuyExecutionByCycle, second.state.recoverySellerBuyExecutionByCycle, "RS BUY execution accumulators must remain account-local.")
  assert.equal(first.state.recoverySellerBuyExecutionByCycle instanceof Map, true, "RS BUY execution state must be an account-local Map.")
  assert.equal(first.state.recoverySellerSellReservations instanceof Map, true, "RS SELL reservations must be an account-local Map.")
  assert.equal(first.state.recoverySellerCycleStates instanceof Map, true, "RS cycle state must be account-local.")
  assert.equal(first.state.recoverySellerCycleOutcomes instanceof Map, true, "RS cycle outcomes must be account-local.")
  assert.notEqual(first.state.recoverySellerCycleStates, second.state.recoverySellerCycleStates)
  assert.notEqual(first.state.recoverySellerCycleOutcomes, second.state.recoverySellerCycleOutcomes)
  assert.notEqual(first.state.recoverySellerSellReservations, second.state.recoverySellerSellReservations, "RS SELL reservations must not be shared across accounts.")
  assert.notEqual(first.state.journalFills, second.state.journalFills, "Applied-fill identities must remain account-local.")
  assert.notEqual(first.state.pausedMarkets, second.state.pausedMarkets, "A pause in one account must not pause another account.")
  assert.notEqual(first.marketMetadata, second.marketMetadata, "Market metadata state must not be shared across account contexts.")
  assert.equal(first.identity.accountId, "account-one", "The first runtime must retain its configured account identity.")
  assert.equal(second.identity.accountId, "account-two", "The second runtime must retain its configured account identity.")
  assert.deepEqual(registry.list().map(({ providerInstanceId }) => providerInstanceId), [
    "binance-testnet-one",
    "binance-testnet-two",
  ], "Registry listing must preserve deterministic provider registration order.")
})

test("rejects duplicate provider/account/environment scopes", () => {
  const duplicateAccountProviders = [
    providers[0],
    {
      ...providers[1],
      accountId: providers[0].accountId,
    },
  ]

  assert.throws(
    () => createAccountRuntimeRegistry({ providers: duplicateAccountProviders }),
    /duplicate provider account identity/,
    "Two provider instances must not create independent runtime state for the same exchange account.",
  )
})

test("rejects incomplete or invalid provider account descriptors", () => {
  assert.throws(
    () => createAccountRuntimeRegistry({
      providers: [{
        ...providers[0],
        accountId: "",
      }],
    }),
    /accountId must be a stable non-secret identifier/,
    "An empty account identity must fail before any runtime state is created.",
  )
  assert.throws(
    () => createAccountRuntimeRegistry({ providers: [] }),
    /at least one provider account/,
    "An empty account registry must fail closed.",
  )
})


test("rejects duplicate provider instance ids and unknown account lookups", () => {
  const duplicateProviderInstances = [
    providers[0],
    {
      ...providers[1],
      providerInstanceId: providers[0].providerInstanceId,
      accountId: "account-three",
    },
  ]
  assert.throws(
    () => createAccountRuntimeRegistry({ providers: duplicateProviderInstances }),
    /duplicate providerInstanceId/,
    "A provider instance id must identify exactly one account runtime.",
  )

  const registry = createAccountRuntimeRegistry({ providers })
  assert.throws(
    () => registry.get("missing-provider"),
    /not registered/,
    "Unknown provider instances must not silently receive an account runtime.",
  )
})


function assertSharedMapProperty({ state, property, value } = {}) {
  state[property] = value
  assert.equal(state[property], value)
  assert.throws(() => {
    state[property] = []
  }, /must be a Map/)
}

function assertSharedPortfolioProperty({ state, conservative, recoverySeller } = {}) {
  const nextPortfolio = new Portfolio()
  state.portfolio = nextPortfolio
  assert.equal(conservative.getPortfolio(), nextPortfolio)
  assert.equal(recoverySeller.getPortfolio(), nextPortfolio)
  assert.throws(() => {
    state.portfolio = {}
  }, /must be a Portfolio/)
}

function assertSharedOrderRegistryProperty({ state, recoverySeller } = {}) {
  const nextOrderRegistry = OrderRegistry.empty()
  state.orderRegistry = nextOrderRegistry
  assert.equal(recoverySeller.getOrderRegistry(), nextOrderRegistry)
  assert.throws(() => {
    state.orderRegistry = {}
  }, /must be an OrderRegistry/)
}

test("keeps engine registry replacements visible to every account workflow", () => {
  const accountState = createAccountRuntimeRegistry({ providers }).get("binance-testnet-one").state
  const engineState = {
    registry: accountState.orderRegistry,
  }
  linkSharedAccountOrderRegistry({
    state: engineState,
    initialState: accountState,
  })
  const replacement = OrderRegistry.empty()

  engineState.registry = replacement

  assert.equal(accountState.orderRegistry, replacement)
  assert.equal(engineState.registry, replacement)
})

test("shares one account Portfolio, OrderRegistry, and serialized queue across CG and RS workflows", () => {
  const accountRuntime = createAccountRuntimeRegistry({ providers }).get("binance-testnet-one")
  const { state } = accountRuntime
  const conservative = createPortfolioWorkflow({ sharedState: state })
  const recoverySeller = createRecoverySellerAccountingWorkflow({ sharedState: state })

  assert.equal(conservative.getPortfolio(), state.portfolio)
  assert.equal(recoverySeller.getPortfolio(), state.portfolio)
  assert.equal(recoverySeller.getOrderRegistry(), state.orderRegistry)
  assert.equal(state.legacyPositions instanceof Map, true)
  assertSharedMapProperty({
    state,
    property: "legacyPositions",
    value: new Map(),
  })
  assertSharedPortfolioProperty({
    state,
    conservative,
    recoverySeller,
  })
  assertSharedMapProperty({
    state,
    property: "recoveryLedgers",
    value: new Map(),
  })
  assertSharedMapProperty({
    state,
    property: "recoverySellerBuyExecutionByCycle",
    value: new Map(),
  })
  assertSharedOrderRegistryProperty({
    state,
    recoverySeller,
  })
  const queuedTransition = Promise.resolve()
  state.updateQueue = queuedTransition
  assert.equal(state.updateQueue, queuedTransition)
  assert.equal(Object.isFrozen(state), true)
})

test("serializes CG and RS engine transitions through one account-level queue", async () => {
  const accountRuntime = createAccountRuntimeRegistry({ providers }).get("binance-testnet-one")
  const events = []
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })

  const first = accountRuntime.state.runTransition({
    task: async () => {
      events.push("first-started")
      await firstGate
      events.push("first-finished")
      return "first"
    },
  })
  await Promise.resolve()
  const second = accountRuntime.state.runTransition({
    task: async () => {
      events.push("second-started")
      return "second"
    },
  })
  await Promise.resolve()

  assert.deepEqual(
    events,
    ["first-started"],
    "A second strategy transition must wait while the first account transition is active.",
  )
  releaseFirst()
  const results = await Promise.all([first, second])

  assert.deepEqual(results, ["first", "second"], "The shared account queue must preserve each transition result.")
  assert.deepEqual(
    events,
    ["first-started", "first-finished", "second-started"],
    "CG and RS transitions must execute in one deterministic account-level order.",
  )
})
