import assert from "node:assert/strict"
import test from "node:test"
import { createAccountRuntimeRegistry } from "./account-runtime-registry.js"
import { createPortfolioWorkflow } from "../../use-cases/create-portfolio-workflow.js"
import { createRecoverySellerAccountingWorkflow } from "../../use-cases/create-recovery-seller-accounting-workflow.js"
import { Portfolio } from "../../domain/portfolio/portfolio.js"

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


test("shares one account Portfolio, OrderRegistry, and serialized queue across CG and RS workflows", () => {
  const accountRuntime = createAccountRuntimeRegistry({ providers }).get("binance-testnet-one")
  const conservative = createPortfolioWorkflow({ sharedState: accountRuntime.state })
  const recoverySeller = createRecoverySellerAccountingWorkflow({ sharedState: accountRuntime.state })

  assert.equal(conservative.getPortfolio(), accountRuntime.state.portfolio)
  assert.equal(recoverySeller.getPortfolio(), accountRuntime.state.portfolio)
  assert.equal(recoverySeller.getOrderRegistry(), accountRuntime.state.orderRegistry)
  assert.equal(accountRuntime.state.legacyPositions instanceof Map, true)

  const nextPortfolio = new Portfolio()
  accountRuntime.state.portfolio = nextPortfolio
  assert.equal(conservative.getPortfolio(), nextPortfolio)
  assert.equal(recoverySeller.getPortfolio(), nextPortfolio)
  assert.throws(() => {
    accountRuntime.state.portfolio = {}
  }, /must be a Portfolio/)

  const queuedTransition = Promise.resolve()
  accountRuntime.state.updateQueue = queuedTransition
  assert.equal(accountRuntime.state.updateQueue, queuedTransition)
  assert.equal(Object.isFrozen(accountRuntime.state), true)
})
