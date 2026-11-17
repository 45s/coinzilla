import { StrategyId } from "../../src/domain/strategies/strategy-ids.js"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../src/domain/strategies/conservative/recovery-ledger.js"
import { createFileOperationalStateStore } from "../../src/infrastructure/operational-state/create-file-operational-state-store.js"
import { projectHarvesterOperationalState } from "../../src/infrastructure/operational-state/project-harvester-operational-state.js"
import { evaluateRecoveryCompletion } from "../../src/domain/strategies/conservative/recovery-completion.js"
import { recordConfigurationBaseline } from "../../src/use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../../src/use-cases/record-process-started.js"
import { recordOrderSubmissionIntent } from "../../src/use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../../src/use-cases/record-order-submission-outcome.js"
import { recordExecutionFill } from "../../src/use-cases/record-execution-fill.js"
import { recordRecoveryCycleCompleted } from "../../src/use-cases/record-recovery-cycle-completed.js"
import { recordRecoveryCycleNotCompleted } from "../../src/use-cases/record-recovery-cycle-not-completed.js"
import { recordSafetyBlockerRaised, recordStrategyMarketControl } from "../../src/use-cases/record-safety-control-facts.js"
import { restoreHarvesterOperationalState } from "../../src/use-cases/restore-harvester-operational-state.js"

const baseAsset = new Asset({ id: "asset:BTC",
code: "BTC" })
const quoteAsset = new Asset({ id: "asset:USDT",
code: "USDT" })
const market = new Market({ venue: "binance",
symbol: "BTCUSDT",
baseAsset,
quoteAsset })
const appConfig = {
  strategies: {
    conservative: {
      pairs: {
        BTCUSDT: { enabled: true,
keepQuantity: 0.01,
minProfit: 0.01 },
      },
    },
  },
}
const createDirectory = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-durable-crash-matrix-"))
  t.after(() => rm(directory, { recursive: true,
force: true }))
  return directory
}
const createStore = (...storeArguments) => {
  const [directory, runtimeSessionId = "crash-matrix-process-1"] = storeArguments;
  return createFileOperationalStateStore({
    directory,
    runtimeSessionId,
  });
}
const initializeProcess = async (store) => {
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, initialized.errors?.map(({ message }) => message).join("; "))
  const baseline = await recordConfigurationBaseline({ operationalStateStore: store,
appConfig })
  assert.equal(baseline.ok, true, baseline.errors?.map(({ message }) => message).join("; "))
  const started = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.map(({ message }) => message).join("; "))
}
const readCandidate = (...candidateArguments) => {
  const [directory, runtimeSessionId] = candidateArguments;
  return restoreHarvesterOperationalState({
    projectOperationalState: projectHarvesterOperationalState,
    operationalStateStore: createStore(directory, runtimeSessionId),
    marketMetadata: new Map([[market.symbol, { market }]]),
  });
}
const makeOrder = ({
  clientOrderId,
  brokerOrderId = null,
  side,
  quantity,
  price,
  status = "PENDING",
  executedQuantity = "0",
} = {}) => new CanonicalOrder({
  clientOrderId,
  ...(brokerOrderId ? { brokerOrderId } : {}),
  market,
  side,
  type: "LIMIT",
  limitPrice: new Money({ amount: price,
asset: quoteAsset }),
  originalQuantity: new Quantity({ amount: quantity,
asset: baseAsset }),
  executedQuantity: new Quantity({ amount: executedQuantity,
asset: baseAsset }),
  status,
  createdAt: 1_700_000_000_000,
  ...(status !== "PENDING" ? { acknowledgedAt: 1_700_000_000_001 } : {}),
  updatedAt: 1_700_000_000_002,
  ...(status === "FILLED" ? { completedAt: 1_700_000_000_003 } : {}),
})
const acknowledge = ({ clientOrderId, side, quantity, price }) =>
  makeOrder({
    clientOrderId,
    brokerOrderId: `broker-${  clientOrderId}`,
    side,
    quantity,
    price,
    status: "FILLED",
    executedQuantity: quantity,
  })
const makeFill = ({ tradeId, clientOrderId, brokerOrderId, side, quantity, quoteQuantity, price }) =>
  new Fill({
    tradeId,
    clientOrderId,
    brokerOrderId,
    market,
    side,
    price: new Money({ amount: price,
asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity,
asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity,
asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_010,
    commissionStatus: "COMPLETE",
    commissions: [],
  })
const persistOrder = async ({ store, clientOrderId, side, quantity, price, purpose = null }) => {
  const pending = makeOrder({ clientOrderId,
side,
quantity,
price })
  const intent = await recordOrderSubmissionIntent({ operationalStateStore: store,
order: pending,
purpose })
  assert.equal(intent.ok, true, intent.errors?.map(({ message }) => message).join("; "))
  const acknowledged = acknowledge({ clientOrderId,
side,
quantity,
price,
purpose })
  const outcome = await recordOrderSubmissionOutcome({
    operationalStateStore: store,
    order: acknowledged,
    outcome: "ACKNOWLEDGED",
    purpose,
  })
  assert.equal(outcome.ok, true, outcome.errors?.map(({ message }) => message).join("; "))
  return acknowledged
}
const applyFill = async ({ store, fill }) => {
  const result = await recordExecutionFill({ operationalStateStore: store,
fill })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
}

async function recordCrashBoundaryIntentAndAcknowledgement({ directory, store }) {
  const pending = makeOrder({
    clientOrderId: "crash-matrix-buy-1",
    side: "BUY",
    quantity: "0.02",
    price: "100",
  })
  const intent = await recordOrderSubmissionIntent({ operationalStateStore: store, order: pending })
  assert.equal(intent.ok, true, intent.errors?.map(({ message }) => message).join("; "))
  const afterIntent = await readCandidate(directory, "crash-reader-after-intent")
  assert.equal(afterIntent.ok, true, afterIntent.errors?.map(({ message }) => message).join("; "))
  const intentOrder = afterIntent.data.orderRegistry.getOrder({ clientOrderId: pending.clientOrderId })
  assert.equal(intentOrder.status, "UNKNOWN", "A durable intent without an acknowledgement must restore as UNKNOWN.")
  assert.equal(intentOrder.brokerOrderId, undefined, "An unacknowledged intent must not invent a broker order ID.")
  assert.equal(afterIntent.data.requiresExchangeReconciliation, true, "The offline candidate must require exchange reconciliation.")
  assert.equal(afterIntent.data.restorationEnabled, false, "The offline candidate must never enable runtime restoration.")

  const acknowledged = makeOrder({
    clientOrderId: pending.clientOrderId,
    brokerOrderId: "broker-crash-matrix-buy-1",
    side: "BUY",
    quantity: "0.02",
    price: "100",
    status: "OPEN",
    executedQuantity: "0",
  })
  const outcome = await recordOrderSubmissionOutcome({
    operationalStateStore: store,
    order: acknowledged,
    outcome: "ACKNOWLEDGED",
  })
  assert.equal(outcome.ok, true, outcome.errors?.map(({ message }) => message).join("; "))
  const afterAcknowledgement = await readCandidate(directory, "crash-reader-after-ack")
  assert.equal(afterAcknowledgement.ok, true, afterAcknowledgement.errors?.map(({ message }) => message).join("; "))
  const acknowledgedOrder = afterAcknowledgement.data.orderRegistry.getOrder({ clientOrderId: pending.clientOrderId })
  assert.equal(acknowledgedOrder.status, "UNKNOWN", "An acknowledgement alone must not prove the current exchange order status.")
  assert.equal(acknowledgedOrder.brokerOrderId, "broker-crash-matrix-buy-1", "The acknowledged broker order ID must survive the crash boundary.")
  assert.equal(acknowledgedOrder.executedQuantity.amount, "0", "An acknowledgement must not invent executed quantity.")
  return { pending, acknowledged }
}

async function verifyCrashBoundaryFill({ directory, store, pending, acknowledged }) {
  const fill = makeFill({
    tradeId: "crash-matrix-buy-trade-1",
    clientOrderId: pending.clientOrderId,
    brokerOrderId: acknowledged.brokerOrderId,
    side: "BUY",
    quantity: "0.02",
    quoteQuantity: "2",
    price: "100",
  })
  await applyFill({ store, fill })
  const afterFill = await readCandidate(directory, "crash-reader-after-fill")
  assert.equal(afterFill.ok, true, afterFill.errors?.map(({ message }) => message).join("; "))
  const filledOrder = afterFill.data.orderRegistry.getOrder({ clientOrderId: pending.clientOrderId })
  assert.equal(filledOrder.status, "UNKNOWN", "A durable fill does not prove current exchange order status.")
  assert.equal(filledOrder.executedQuantity.amount, "0.02", "The exact executed quantity must survive the fill crash boundary.")
  assert.equal(afterFill.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "0.02", "The candidate Portfolio must restore the exact filled base quantity.")
  assert.equal(afterFill.data.portfolio.getPosition({ marketId: market.id }).spent.amount, "2", "The candidate Portfolio must restore the exact quote cost.")
  assert.equal(afterFill.data.recoveryLedgers.get(market.id).buyCost, "2", "The RecoveryLedger must restore the exact BUY cost.")
  assert.equal(afterFill.data.requiresExchangeReconciliation, true, "The filled offline candidate must still require exchange reconciliation.")
}

test("reopens the real append-only ledger after intent, acknowledgement, and fill crash boundaries", async (t) => {
  const directory = await createDirectory(t)
  const store = createStore(directory)
  await initializeProcess(store)
  const { pending, acknowledged } = await recordCrashBoundaryIntentAndAcknowledgement({ directory, store })
  await verifyCrashBoundaryFill({ directory, store, pending, acknowledged })
})

async function createRecoveryCycleAccountingEvidence({
  store,
  cycleName,
  buyQuantity,
  sellQuantity,
  buyPrice,
  sellPrice,
  buyQuoteQuantity,
  sellQuoteQuantity,
}) {
  const buyOrder = await persistOrder({
    store,
    clientOrderId: `crash-matrix-${cycleName}-buy`,
    side: "BUY",
    quantity: buyQuantity,
    price: buyPrice,
  })
  const sellOrder = await persistOrder({
    store,
    clientOrderId: `crash-matrix-${cycleName}-sell`,
    side: "SELL",
    quantity: sellQuantity,
    price: sellPrice,
    purpose: "RECOVERY_SELL",
  })
  const buyFill = makeFill({
    tradeId: `crash-matrix-${cycleName}-buy-fill`,
    clientOrderId: buyOrder.clientOrderId,
    brokerOrderId: buyOrder.brokerOrderId,
    side: "BUY",
    quantity: buyQuantity,
    quoteQuantity: buyQuoteQuantity,
    price: buyPrice,
  })
  const sellFill = makeFill({
    tradeId: `crash-matrix-${cycleName}-sell-fill`,
    clientOrderId: sellOrder.clientOrderId,
    brokerOrderId: sellOrder.brokerOrderId,
    side: "SELL",
    quantity: sellQuantity,
    quoteQuantity: sellQuoteQuantity,
    price: sellPrice,
  })
  await applyFill({ store, fill: buyFill })
  await applyFill({ store, fill: sellFill })
  const { portfolio } = new Portfolio()
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).portfolio
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER })
  const recoveryLedger = RecoveryLedger.empty({ market })
    .applyFill({ fill: buyFill, strategyId: StrategyId.COIN_GRABBER }).ledger
    .applyFill({ fill: sellFill, strategyId: StrategyId.COIN_GRABBER }).ledger
  const position = portfolio.getPosition({ marketId: market.id })
  return { buyOrder, sellOrder, recoveryLedger, position }
}

async function recordNotCompletedRecoveryCycle({ store } = {}) {
  const evidence = await createRecoveryCycleAccountingEvidence({
    store,
    cycleName: "noncomplete",
    buyQuantity: "0.42",
    sellQuantity: "0.4",
    buyPrice: "95",
    sellPrice: "100",
    buyQuoteQuantity: "39.9",
    sellQuoteQuantity: "40",
  })
  const { recoveryLedger, position, sellOrder } = evidence
  const evaluated = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "0.01",
    minProfit: "0.01",
  })
  const completion = Object.freeze({
    ...evaluated,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "0.01",
    minProfit: "0.01",
  })
  assert.equal(completion.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  const recorded = await recordRecoveryCycleNotCompleted({
    operationalStateStore: store,
    recoveryLedger,
    position,
    sellOrder,
    completion,
    minProfit: "0.01",
  })
  assert.equal(recorded.ok, true, recorded.errors?.map(({ message }) => message).join("; "))
  return { recoveryLedger }
}

test("reopens a NOT_COMPLETED recovery SELL with exact cycle evidence and sticky safety state", async (t) => {
  const directory = await createDirectory(t)
  const store = createStore(directory)
  await initializeProcess(store)
  const { recoveryLedger } = await recordNotCompletedRecoveryCycle({ store })

  await recordStrategyMarketControl({
    operationalStateStore: store,
    action: "PAUSE",
    transitionId: "crash-matrix-pause-1",
    symbol: market.symbol,
    reason: "RECOVERY_RECONCILIATION_REQUIRED",
  })
  await recordSafetyBlockerRaised({
    operationalStateStore: store,
    scope: "MARKET",
    symbol: market.symbol,
    reason: "UNOWNED_ORDER",
    evidenceDigest: "a".repeat(64),
  })

  const recovered = await readCandidate(directory, "crash-reader-after-noncompleted-sell")
  assert.equal(recovered.ok, true, recovered.errors?.map(({ message }) => message).join("; "))
  assert.equal(recovered.data.recoveryCycleEvaluations.length, 1)
  assert.equal(recovered.data.recoveryCycleEvaluations[0].outcome, "CONTINUE_SELL_THROUGH")
  assert.ok(Number.isSafeInteger(recovered.data.recoveryCycleEvaluations[0].sequence), "Durable fact sequence must become a safe numeric replay sequence.")
  assert.equal(recovered.data.recoveryCycleEvaluations[0].sellOrderClientId, "crash-matrix-noncomplete-sell")
  assert.deepEqual(recovered.data.recoveryCycleEvaluations[0].appliedFillIds, recoveryLedger.appliedFillIds)
  assert.deepEqual([...recovered.data.durablePausedMarkets], [market.symbol])
  assert.equal(recovered.data.stickySafetyBlockers.length, 1)
  assert.equal(recovered.data.requiresExchangeReconciliation, true)
  assert.equal(recovered.data.restorationEnabled, false)
})

async function recordCompletedRecoveryCycle({ store }) {
  const evidence = await createRecoveryCycleAccountingEvidence({
    store,
    cycleName: "completed",
    buyQuantity: "2",
    sellQuantity: "1",
    buyPrice: "65000",
    sellPrice: "130005",
    buyQuoteQuantity: "130000",
    sellQuoteQuantity: "130005",
  })
  const { buyOrder, sellOrder, recoveryLedger, position } = evidence
  const evaluated = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: position.spent.amount,
    netSellProceeds: recoveryLedger.netSellProceeds,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    minProfit: "5",
  })
  const completion = Object.freeze({
    ...evaluated,
    activeQuantity: position.baseQuantity.amount,
    keepQuantity: "1",
    minProfit: "5",
  })
  assert.equal(completion.eligible, true, "The exact completed recovery cycle must meet the configured profit threshold.")
  const recorded = await recordRecoveryCycleCompleted({
    operationalStateStore: store,
    recoveryLedger,
    position,
    sellOrder,
    completion,
    minProfit: "5",
  })
  assert.equal(recorded.ok, true, recorded.errors?.map(({ message }) => message).join("; "))
  return { buyOrder, sellOrder, recoveryLedger, recorded }
}

test("reopens a completed cycle with exact retained inventory and reset recovery basis", async (t) => {
  const directory = await createDirectory(t)
  const store = createStore(directory)
  await initializeProcess(store)

  const { sellOrder, recoveryLedger, recorded } = await recordCompletedRecoveryCycle({ store });

  const recovered = await readCandidate(directory, "crash-reader-after-completed-cycle")
  assert.equal(recovered.ok, true, recovered.errors?.map(({ message }) => message).join("; "))
  assert.equal(recovered.data.recoveryCycles.length, 1)
  assert.equal(recovered.data.recoveryCycles[0].cycleId, recorded.data.record.data.cycleId)
  assert.ok(Number.isSafeInteger(recovered.data.recoveryCycles[0].sequence), "Durable fact sequence must become a safe numeric replay sequence.")
  assert.equal(recovered.data.recoveryCycles[0].sellOrderClientId, sellOrder.clientOrderId)
  assert.deepEqual(recovered.data.recoveryCycles[0].appliedFillIds, recoveryLedger.appliedFillIds)
  const recoveredPosition = recovered.data.portfolio.getPosition({ marketId: market.id })
  assert.equal(recoveredPosition.baseQuantity.amount, "0")
  assert.equal(recoveredPosition.freeBaseQuantity.amount, "1")
  assert.equal(recoveredPosition.spent.amount, "0")
  assert.equal(recovered.data.recoveryLedgers.get(market.id).buyCost, "0")
  assert.equal(recovered.data.completedOrderClientIds.has(sellOrder.clientOrderId), true)
  assert.equal(recovered.data.requiresExchangeReconciliation, true)
  assert.equal(recovered.data.restorationEnabled, false)
})
