import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { Market } from "@coinzilla/entities"
import { auditRecoveredTradeHistory } from "./audit-recovered-trade-history.js"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { addDecimal, assertDecimalString, compareDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"

function addAmount({ amounts, asset, amount }) {
  const current = amounts.get(asset) ?? "0"
  amounts.set(asset, addDecimal({ left: current, right: amount }))
}

function requireAmount({ value, field }) {
  if (typeof value !== "string") throw new TypeError(field + " must be an exact decimal string")
  assertDecimalString({ value, field })
  return value
}

function getOrderPrice({ order }) {
  const value = order.originalPrice ?? order.limitPrice?.amount ?? order.price?.amount ?? order.price
  return typeof value === "number" ? String(value) : value
}

function getOpenOrderIdentity({ order }) {
  return {
    brokerOrderId: order.brokerOrderId ?? order.id,
    symbol: order.market?.symbol ?? order.symbol,
    clientOrderId: order.clientOrderId,
    originalQuantity: order.originalQuantity?.amount ?? order.originalQuantity,
    executedQuantity: order.executedQuantity?.amount ?? order.executedQuantity,
  }
}

function normalizeOrderStatus({ status }) {
  return status === "NEW" ? "OPEN" : status
}

function getInitialTradingSnapshot({ projection }) {
  const firstTradingSession = projection.data.sessions.find((session) =>
    session.tradingEnabled || session.hasTradingActivity
  )
  if (!firstTradingSession) return undefined
  const snapshots = projection.data.accountSnapshots.filter((snapshot) =>
    snapshot.fileName === firstTradingSession.fileName &&
    ["PREFLIGHT", "COMMISSION_BASELINE"].includes(snapshot.phase)
  )
  if (snapshots.length === 0) return undefined

  const initial = snapshots[0]
  const balancesByAsset = new Map()
  const auditReasons = new Set()
  let auditStatus = "COMPLETE"
  for (const snapshot of snapshots) {
    if (snapshot.sourceTime !== initial.sourceTime) {
      throw new Error("PREFLIGHT commission-asset baseline must retain the original account snapshot time")
    }
    if (snapshot.auditStatus !== "COMPLETE" || snapshot.auditReasons.length > 0) {
      auditStatus = "INCOMPLETE"
      for (const reason of snapshot.auditReasons) auditReasons.add(reason)
    }
    for (const balance of snapshot.balances) {
      const previous = balancesByAsset.get(balance.asset)
      if (previous && (
        previous.free !== balance.free ||
        previous.locked !== balance.locked ||
        previous.total !== balance.total
      )) {
        throw new Error("PREFLIGHT account snapshots contain contradictory baseline balances for " + balance.asset)
      }
      balancesByAsset.set(balance.asset, balance)
    }
  }
  return {
    ...initial,
    auditStatus,
    auditReasons: [...auditReasons],
    balances: [...balancesByAsset.values()].sort((left, right) => left.asset.localeCompare(right.asset)),
  }
}

/**
 * Compare replayed strategy-owned inventory and commitments with a fresh,
 * read-only exchange account snapshot and the account open-order set. External
 * orders remain unowned and untouched; their exact reservations are included,
 * while their symbols are returned as narrow strategy blockers. Missing asset
 * coverage or unexplained commitments fail closed. This function performs no
 * broker calls and no exchange mutations.
 */
export function auditRecoveredAccountState({
  projection,
  recoveredState,
  currentAccountSnapshot,
  openOrders,
  markets,
  exchangeTradeHistory,
  requireCompleteTradeHistory = false,
  tradeHistoryScope = "ACCOUNT",
  targetMarket,
} = {}) {
  try {
    if (projection?.ok !== true || !projection.data) {
      throw new TypeError("auditRecoveredAccountState requires a successful Journal recovery projection")
    }
    if (!(recoveredState?.portfolio instanceof Portfolio)) {
      throw new TypeError("auditRecoveredAccountState requires a restored Portfolio")
    }
    if (!(recoveredState.orderRegistry instanceof OrderRegistry)) {
      throw new TypeError("auditRecoveredAccountState requires a restored OrderRegistry")
    }
    if (!(currentAccountSnapshot instanceof AccountSnapshot)) {
      throw new TypeError("auditRecoveredAccountState requires a canonical current AccountSnapshot")
    }
    if (!Array.isArray(openOrders)) throw new TypeError("openOrders must be an array")
    if (!Array.isArray(markets)) throw new TypeError("markets must be an array")
    if (targetMarket !== undefined && !(targetMarket instanceof Market)) {
      throw new TypeError("targetMarket must be a canonical Market")
    }

    if (!projection.data.requiresExchangeReconciliation) {
      return toResult({ data: Object.freeze({ skipped: true, reason: "NO_PRIOR_TRADING_STATE" }) })
    }
    if (!Array.isArray(recoveredState.journalFills)) {
      throw new TypeError("auditRecoveredAccountState requires restored Journal fill facts")
    }

    const baseline = getInitialTradingSnapshot({ projection })
    if (!baseline) {
      throw new Error("Initial trading-session PREFLIGHT account snapshot is missing; account ownership cannot be proven")
    }
    if (baseline.auditStatus !== "COMPLETE" || baseline.auditReasons.length > 0) {
      throw new Error("Initial trading-session PREFLIGHT account snapshot is incomplete; account ownership cannot be proven")
    }
    let tradeHistoryAudit
    if (requireCompleteTradeHistory === true) {
      tradeHistoryAudit = auditRecoveredTradeHistory({
        journalFills: recoveredState.journalFills,
        exchangeFills: exchangeTradeHistory?.fills,
        ownedOrders: recoveredState.orderRegistry.orders,
        complete: exchangeTradeHistory?.historyPagesComplete === true,
        marketUniverseComplete: exchangeTradeHistory?.marketUniverseComplete === true,
        scope: tradeHistoryScope,
        market: targetMarket,
        historyEvidence: exchangeTradeHistory,
        historyRetentionEvidence: exchangeTradeHistory?.historyRetentionEvidence,
      })
      if (!tradeHistoryAudit.ok) {
        throw tradeHistoryAudit.errors?.[0] ?? new Error("Complete account-wide trade history could not be verified")
      }
      if (tradeHistoryAudit.data.scope === "MARKET" &&
          tradeHistoryAudit.data.historyRetentionVerifiedAt > currentAccountSnapshot.sourceTime) {
        throw new Error("Market-history retention baseline was verified after the current account snapshot")
      }
    }
    const latestRecordedSourceTime = projection.data.accountSnapshots.reduce(
      (latest, snapshot) => Math.max(latest, snapshot.sourceTime),
      baseline.sourceTime,
    )
    if (currentAccountSnapshot.sourceTime < latestRecordedSourceTime) {
      throw new Error("Current exchange account snapshot is older than the latest durable Journal account snapshot")
    }

    const baselineByAsset = new Map(baseline.balances.map((balance) => [balance.asset, {
      total: balance.total,
      locked: balance.locked,
    }]))
    const baselineSequenceByAsset = new Map()
    for (const snapshot of projection.data.accountSnapshots) {
      if (snapshot.fileName !== baseline.fileName ||
          !["PREFLIGHT", "COMMISSION_BASELINE"].includes(snapshot.phase)) continue
      for (const balance of snapshot.balances) {
        const previousSequence = baselineSequenceByAsset.get(balance.asset)
        if (previousSequence === undefined || snapshot.sequence < previousSequence) {
          baselineSequenceByAsset.set(balance.asset, snapshot.sequence)
        }
      }
    }
    const currentByAsset = new Map()
    for (const balance of currentAccountSnapshot.balances) {
      const code = balance.asset.code
      if (currentByAsset.has(code)) throw new Error("Current account snapshot contains duplicate asset code " + code)
      currentByAsset.set(code, {
        total: addDecimal({ left: balance.free.amount, right: balance.locked.amount }),
        locked: balance.locked.amount,
      })
    }

    const expectedDeltas = new Map()
    const marketsById = new Map()
    const marketsBySymbol = new Map()
    for (const position of recoveredState.portfolio.value.positions) {
      if (!markets.some((market) => market.id === position.market.id)) {
        throw new Error("Canonical Market metadata is missing for restored Position " + position.market.symbol)
      }
    }
    for (const order of recoveredState.orderRegistry.orders) {
      if (!markets.some((market) => market.id === order.market.id)) {
        throw new Error("Canonical Market metadata is missing for restored order " + order.clientOrderId)
      }
    }
    for (const market of markets) {
      if (!(market instanceof Market)) {
        throw new TypeError("markets must contain canonical Market values")
      }
      if (marketsById.has(market.id)) throw new Error("Duplicate canonical Market metadata for " + market.id)
      if (marketsBySymbol.has(market.symbol)) throw new Error("Duplicate canonical Market symbol " + market.symbol)
      marketsById.set(market.id, market)
      marketsBySymbol.set(market.symbol, market)
      const position = recoveredState.portfolio.getPosition({ marketId: market.id, strategyId: StrategyId.COIN_GRABBER })
      if (!position) continue
      addAmount({
        amounts: expectedDeltas,
        asset: market.baseAsset.code,
        amount: requireAmount({ value: position.totalBaseQuantity.amount, field: market.symbol + ".totalBaseQuantity" }),
      })
      addAmount({
        amounts: expectedDeltas,
        asset: market.quoteAsset.code,
        amount: requireAmount({ value: position.quoteNetCashFlow.amount, field: market.symbol + ".quoteNetCashFlow" }),
      })
    }
    if (targetMarket && marketsBySymbol.get(targetMarket.symbol)?.id !== targetMarket.id) {
      throw new Error("Canonical Market metadata is missing for target market " + targetMarket.symbol)
    }

    const commissionAssetIdByCode = new Map()
    const commissionAssetCodeById = new Map()
    const thirdAssetCommissionCodes = new Set()
    for (const market of markets) {
      for (const asset of [market.baseAsset, market.quoteAsset]) {
        const knownId = commissionAssetIdByCode.get(asset.code)
        const knownCode = commissionAssetCodeById.get(asset.id)
        if ((knownId !== undefined && knownId !== asset.id) ||
            (knownCode !== undefined && knownCode !== asset.code)) {
          throw new Error("Canonical Market metadata contains contradictory asset identity for " + asset.code)
        }
        commissionAssetIdByCode.set(asset.code, asset.id)
        commissionAssetCodeById.set(asset.id, asset.code)
      }
    }
    for (const fill of recoveredState.journalFills) {
      if (typeof fill?.symbol !== "string" || !Array.isArray(fill.commissions)) {
        throw new TypeError("Recovered Journal fill is missing symbol or commission facts")
      }
      const market = marketsBySymbol.get(fill.symbol)
      if (!market) throw new Error("Canonical Market metadata is missing for recovered fill " + fill.symbol)
      for (const commission of fill.commissions) {
        const amount = requireAmount({
          value: commission?.amount,
          field: fill.symbol + ".commission.amount",
        })
        if (compareDecimal({ left: amount, right: "0" }) < 0) {
          throw new Error("Recovered commission amount cannot be negative for " + fill.symbol)
        }
        const assetId = commission?.assetId
        const asset = commission?.asset
        if (typeof assetId !== "string" || !assetId.trim() ||
            typeof asset !== "string" || !asset.trim()) {
          throw new TypeError("Recovered commission requires exact asset ID and code for " + fill.symbol)
        }
        if (assetId === market.baseAsset.id) {
          if (asset !== market.baseAsset.code) {
            throw new Error("Recovered commission asset code contradicts market base asset identity for " + fill.symbol)
          }
          continue
        }
        if (assetId === market.quoteAsset.id) {
          if (asset !== market.quoteAsset.code) {
            throw new Error("Recovered commission asset code contradicts market quote asset identity for " + fill.symbol)
          }
          continue
        }
        if (asset === market.baseAsset.code || asset === market.quoteAsset.code) {
          throw new Error("Recovered commission asset ID contradicts a market asset code for " + fill.symbol)
        }
        const knownId = commissionAssetIdByCode.get(asset)
        const knownCode = commissionAssetCodeById.get(assetId)
        if ((knownId !== undefined && knownId !== assetId) ||
            (knownCode !== undefined && knownCode !== asset)) {
          throw new Error("Recovered third-asset commission identity is contradictory for " + asset)
        }
        commissionAssetIdByCode.set(asset, assetId)
        commissionAssetCodeById.set(assetId, asset)
        if (compareDecimal({ left: amount, right: "0" }) === 0) continue

        // A later snapshot cannot retroactively explain a fee debit that already occurred.
        const baselineSequence = baselineSequenceByAsset.get(asset)
        if (!baselineByAsset.has(asset) || !Number.isSafeInteger(baselineSequence)) {
          throw new Error("Initial account snapshot is missing required third-asset commission baseline for " + asset)
        }
        if (!Number.isSafeInteger(fill.sequence) || baselineSequence >= fill.sequence) {
          throw new Error("Third-asset commission baseline must be durably recorded before its applied fill for " + asset)
        }
        const quoteValue = commission.quoteValue
        if (!quoteValue ||
            quoteValue.assetId !== market.quoteAsset.id ||
            quoteValue.asset !== market.quoteAsset.code ||
            typeof quoteValue.amount !== "string" ||
            compareDecimal({ left: requireAmount({
              value: quoteValue.amount,
              field: fill.symbol + ".commission.quoteValue.amount",
            }), right: "0" }) <= 0) {
          throw new Error("Recovered third-asset commission has no valid historical quote valuation for " + fill.symbol)
        }
        thirdAssetCommissionCodes.add(asset)
        addAmount({
          amounts: expectedDeltas,
          asset,
          amount: subtractDecimal({ left: "0", right: amount }),
        })
      }
    }

    for (const asset of thirdAssetCommissionCodes) {
      if (!baselineByAsset.has(asset)) {
        throw new Error("Initial account snapshot is missing required third-asset commission baseline for " + asset)
      }
    }
    const relevantMarketIds = new Set([
      ...recoveredState.portfolio.value.positions.map((position) => position.market.id),
      ...recoveredState.orderRegistry.orders.map((order) => order.market.id),
      ...(targetMarket ? [targetMarket.id] : []),
      ...openOrders.map((order) => {
        const symbol = order.market?.symbol ?? order.symbol
        return marketsBySymbol.get(symbol)?.id
      }).filter(Boolean),
    ])
    const relevantMarkets = [...marketsById.values()].filter((market) => relevantMarketIds.has(market.id))
    const marketAssetCodes = new Set(relevantMarkets.flatMap((market) => [
      market.baseAsset.code,
      market.quoteAsset.code,
    ]))
    const assetCodes = new Set([
      ...baselineByAsset.keys(),
      ...currentByAsset.keys(),
      ...marketAssetCodes,
      ...expectedDeltas.keys(),
    ])
    for (const asset of assetCodes) {
      if (!baselineByAsset.has(asset)) {
        throw new Error("Initial account snapshot is missing required asset " + asset)
      }
      if (!currentByAsset.has(asset)) {
        throw new Error("Current account snapshot is missing required asset " + asset)
      }
      const initial = baselineByAsset.get(asset).total
      const delta = expectedDeltas.get(asset) ?? "0"
      const expected = addDecimal({ left: initial, right: delta })
      if (compareDecimal({ left: expected, right: "0" }) < 0) {
        throw new Error("Replayed strategy accounting predicts a negative account balance for " + asset)
      }
      const actual = currentByAsset.get(asset).total
      if (compareDecimal({ left: actual, right: expected }) !== 0) {
        throw new Error(
          "Exchange balance does not match replayed Harvester ownership for " + asset +
          ": expected " + expected + ", received " + actual,
        )
      }
    }

    const expectedOpenOrders = recoveredState.orderRegistry.getActiveOrders({})
    const expectedByBrokerId = new Map()
    const recoveredByBrokerId = new Map()
    const recoveredByClientOrderId = new Map()
    const expectedLocked = new Map()
    for (const order of recoveredState.orderRegistry.orders) {
      if (recoveredByClientOrderId.has(order.clientOrderId)) {
        throw new Error("Recovered OrderRegistry contains duplicate clientOrderId " + order.clientOrderId)
      }
      recoveredByClientOrderId.set(order.clientOrderId, order)
      if (typeof order.brokerOrderId === "string" && order.brokerOrderId.trim()) {
        if (recoveredByBrokerId.has(order.brokerOrderId)) {
          throw new Error("Recovered OrderRegistry contains duplicate brokerOrderId " + order.brokerOrderId)
        }
        recoveredByBrokerId.set(order.brokerOrderId, order)
      }
    }
    for (const order of expectedOpenOrders) {
      if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
        throw new Error("Recovered active order remains unresolved and cannot pass account audit: " + order.clientOrderId)
      }
      if (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
        throw new Error("Recovered active order has no brokerOrderId: " + order.clientOrderId)
      }
      if (expectedByBrokerId.has(order.brokerOrderId)) {
        throw new Error("Recovered OrderRegistry contains duplicate brokerOrderId " + order.brokerOrderId)
      }
      expectedByBrokerId.set(order.brokerOrderId, order)
      const remainingQuantity = subtractDecimal({
        left: order.originalQuantity.amount,
        right: order.executedQuantity.amount,
      })
      if (compareDecimal({ left: remainingQuantity, right: "0" }) <= 0) {
        throw new Error("Recovered active order has no remaining quantity: " + order.clientOrderId)
      }
      if (!["LIMIT", "LIMIT_MAKER"].includes(order.type) || !order.limitPrice) {
        throw new Error("Recovered active order is not a supported LIMIT commitment: " + order.clientOrderId)
      }
      if (order.side === "BUY") {
        addAmount({
          amounts: expectedLocked,
          asset: order.market.quoteAsset.code,
          amount: multiplyDecimal({
            left: remainingQuantity,
            right: order.limitPrice.amount,
          }),
        })
      } else if (order.side === "SELL") {
        addAmount({
          amounts: expectedLocked,
          asset: order.market.baseAsset.code,
          amount: remainingQuantity,
        })
      } else {
        throw new Error("Recovered active order has an unsupported side: " + order.clientOrderId)
      }
    }

    const actualOpenByBrokerId = new Map()
    const seenOpenOrderIds = new Set()
    const unownedOpenOrders = []
    const blockedMarkets = new Set()
    for (const order of openOrders) {
      const identity = getOpenOrderIdentity({ order })
      const { brokerOrderId, symbol } = identity
      if (typeof brokerOrderId !== "string" || !brokerOrderId.trim() ||
          typeof symbol !== "string" || !symbol.trim() ||
          typeof identity.clientOrderId !== "string" || !identity.clientOrderId.trim()) {
        throw new Error("Exchange open-order snapshot contains an order without canonical identity")
      }
      if (seenOpenOrderIds.has(brokerOrderId)) {
        throw new Error("Exchange open-order snapshot contains duplicate brokerOrderId " + brokerOrderId)
      }
      seenOpenOrderIds.add(brokerOrderId)
      const expected = expectedByBrokerId.get(brokerOrderId)
      if (!expected) {
        if (recoveredByBrokerId.has(brokerOrderId)) {
          throw new Error("Exchange reports a non-active recovered order as open: " + brokerOrderId)
        }
        if (recoveredByClientOrderId.has(identity.clientOrderId)) {
          throw new Error("Unowned exchange order clientOrderId conflicts with recovered order ownership: " + identity.clientOrderId)
        }
        const externalMarket = marketsBySymbol.get(symbol)
        if (!externalMarket) {
          throw new Error("Canonical Market metadata is missing for unowned open order " + symbol)
        }
        const actualStatus = normalizeOrderStatus({ status: order.status })
        if (!["OPEN", "PARTIALLY_FILLED"].includes(actualStatus)) {
          throw new Error("Unowned exchange order has an unsupported open status: " + brokerOrderId)
        }
        if (!["LIMIT", "LIMIT_MAKER"].includes(order.type)) {
          throw new Error("Unowned exchange order has an unsupported commitment type: " + brokerOrderId)
        }
        const originalQuantity = requireAmount({
          value: identity.originalQuantity,
          field: "Unowned order " + brokerOrderId + ".originalQuantity",
        })
        const executedQuantity = requireAmount({
          value: identity.executedQuantity,
          field: "Unowned order " + brokerOrderId + ".executedQuantity",
        })
        const remainingQuantity = subtractDecimal({
          left: originalQuantity,
          right: executedQuantity,
        })
        if (compareDecimal({ left: remainingQuantity, right: "0" }) <= 0) {
          throw new Error("Unowned exchange order has no positive remaining quantity: " + brokerOrderId)
        }
        const actualPrice = requireAmount({
          value: getOrderPrice({ order }),
          field: "Unowned order " + brokerOrderId + ".price",
        })
        if (compareDecimal({ left: actualPrice, right: "0" }) <= 0) {
          throw new Error("Unowned exchange order price must be positive: " + brokerOrderId)
        }
        if (order.side === "BUY") {
          addAmount({
            amounts: expectedLocked,
            asset: externalMarket.quoteAsset.code,
            amount: multiplyDecimal({ left: remainingQuantity, right: actualPrice }),
          })
        } else if (order.side === "SELL") {
          addAmount({
            amounts: expectedLocked,
            asset: externalMarket.baseAsset.code,
            amount: remainingQuantity,
          })
        } else {
          throw new Error("Unowned exchange order has an unsupported side: " + brokerOrderId)
        }
        blockedMarkets.add(symbol)
        unownedOpenOrders.push(Object.freeze({
          brokerOrderId,
          clientOrderId: identity.clientOrderId,
          symbol,
          side: order.side,
          type: order.type,
          status: actualStatus,
        }))
        continue
      }
      const actualPrice = getOrderPrice({ order })
      const expectedPrice = expected.limitPrice?.amount
      const actualStatus = normalizeOrderStatus({ status: order.status })
      const expectedStatus = normalizeOrderStatus({ status: expected.status })
      if (
        expected.clientOrderId !== identity.clientOrderId ||
        expected.market.symbol !== symbol ||
        expected.side !== order.side ||
        expected.type !== order.type ||
        expectedStatus !== actualStatus ||
        compareDecimal({ left: expected.originalQuantity.amount, right: identity.originalQuantity }) !== 0 ||
        compareDecimal({ left: expected.executedQuantity.amount, right: identity.executedQuantity }) !== 0 ||
        compareDecimal({ left: expectedPrice, right: actualPrice }) !== 0
      ) {
        throw new Error("Exchange open-order facts contradict recovered ownership for broker order " + brokerOrderId)
      }
      actualOpenByBrokerId.set(brokerOrderId, order)
    }
    if (actualOpenByBrokerId.size !== expectedByBrokerId.size) {
      const missing = [...expectedByBrokerId.keys()].filter((id) => !actualOpenByBrokerId.has(id))
      throw new Error("Recovered active orders are missing from the exchange open-order snapshot: " + missing.join(", "))
    }

    for (const [asset, expected] of expectedLocked) {
      const actual = currentByAsset.get(asset)?.locked ?? "0"
      if (compareDecimal({ left: actual, right: expected }) !== 0) {
        throw new Error(
          "Exchange locked balance does not match recovered order commitments for " + asset +
          ": expected " + expected + ", received " + actual,
        )
      }
    }
    for (const [asset, actual] of currentByAsset) {
      const initialLocked = baselineByAsset.get(asset)?.locked ?? "0"
      const expected = expectedLocked.get(asset) ??
        (thirdAssetCommissionCodes.has(asset) && !marketAssetCodes.has(asset) ? initialLocked : "0")
      if (compareDecimal({ left: actual.locked, right: expected }) !== 0) {
        throw new Error(
          "Exchange has unexplained locked funds for " + asset +
          ": expected " + expected + ", received " + actual.locked,
        )
      }
    }

    return toResult({
      data: Object.freeze({
        skipped: false,
        balancesChecked: assetCodes.size,
        openOrdersChecked: openOrders.length,
        reservationsChecked: expectedLocked.size,
        unownedOpenOrders: Object.freeze(unownedOpenOrders.sort((left, right) =>
          left.symbol.localeCompare(right.symbol) || left.brokerOrderId.localeCompare(right.brokerOrderId)
        )),
        blockedMarkets: Object.freeze([...blockedMarkets].sort()),
        targetMarketBlocked: targetMarket ? blockedMarkets.has(targetMarket.symbol) : undefined,
        ...(tradeHistoryAudit ? { tradeHistory: tradeHistoryAudit.data } : {}),
        sourceTime: currentAccountSnapshot.sourceTime,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
