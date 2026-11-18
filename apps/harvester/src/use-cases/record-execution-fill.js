import { Fill } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { requireProviderIdentity } from "../domain/orders/provider-provenance.js"

function validateExecutionFillInput({
      operationalStateStore,
      fill,
    }) {
  if (typeof operationalStateStore?.append !== "function") {
    throw new TypeError("recordExecutionFill requires a Operational State Store append capability")
  }
  if (!(fill instanceof Fill)) {
    throw new TypeError("recordExecutionFill requires a canonical Fill")
  }
  if (typeof fill.clientOrderId !== "string" || !fill.clientOrderId.trim()) {
    throw new TypeError("Execution-fill fact requires its original Harvester clientOrderId")
  }
  requireProviderIdentity({
    value: fill,
    context: "Execution-fill fact",
  })
  return fill.market
}

function serializeCommissions({ fill }) {
  return fill.commissions.map((commission) => ({
    amount: commission.amount.amount,
    assetId: commission.amount.asset.id,
    assetCode: commission.amount.asset.code,
    quoteValue: commission.quoteValue
      ? {
          amount: commission.quoteValue.amount,
          assetId: commission.quoteValue.asset.id,
          assetCode: commission.quoteValue.asset.code,
        }
      : null,
  }))
}

/**
 * Persist a complete canonical execution fact before Portfolio/RecoveryLedger
 * references are committed or strategy progression can continue.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Initialized ADR-0001 Operational State Store append capability.
 * @param {Fill} options.fill - Validated canonical execution.
 * @returns {Promise<object>} Durable append result; success requires durable === true.
 */
export async function recordExecutionFill({ operationalStateStore, fill } = {}) {
  try {
    const market = validateExecutionFillInput({
      operationalStateStore,
      fill,
    })
    const commissions = serializeCommissions({ fill })
    const result = await operationalStateStore.append({
      factId: `execution-fill-applied:${fill.id}`,
      factType: "EXECUTION_FILL_APPLIED",
      data: {
        fillId: fill.id,
        tradeId: fill.tradeId,
        brokerOrderId: fill.brokerOrderId,
        clientOrderId: fill.clientOrderId,
        providerInstanceId: fill.providerInstanceId,
        providerType: fill.providerType,
        accountId: fill.accountId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        side: fill.side,
        price: fill.price.amount,
        quantity: fill.quantity.amount,
        quoteQuantity: fill.quoteQuantity.amount,
        liquidityRole: fill.liquidityRole,
        executedAt: fill.executedAt ?? null,
        commissionStatus: fill.commissionStatus,
        commissions,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Execution-fill append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}