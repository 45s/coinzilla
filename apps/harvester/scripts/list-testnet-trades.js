import { getMyTrades } from "./binance-testnet-api.js"
import {
  normalizeTradeHistory,
  parseTradeHistoryArguments,
} from "./testnet-trade-history-utils.js"

const main = async () => {
  const { symbol, limit } = parseTradeHistoryArguments({
    args: process.argv.slice(2),
  })
  const { trades: responseTrades } = await getMyTrades({ symbol, limit })
  const { trades } = normalizeTradeHistory({ trades: responseTrades })

  console.log(`\\nBinance Spot TESTNET — Actual Trades: ${symbol}\\n`)

  if (trades.length === 0) {
    console.log(`No trade history found for ${symbol}.`)
    return
  }

  console.table(
    trades.map((trade) => ({
      time: new Date(trade.time).toISOString(),
      tradeId: trade.tradeId,
      orderId: trade.orderId,
      side: trade.side,
      liquidity: trade.liquidity,
      price: trade.price,
      quantity: trade.quantity,
      quoteQuantity: trade.quoteQuantity,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
    })),
  )

  const totals = trades.reduce((result, trade) => {
    const quantity = Number(trade.quantity)
    const quoteQuantity = Number(trade.quoteQuantity)
    if (trade.side === "BUY") {
      result.buyQuantity += quantity
      result.buyQuote += quoteQuantity
      result.buyTrades += 1
    } else {
      result.sellQuantity += quantity
      result.sellQuote += quoteQuantity
      result.sellTrades += 1
    }
    const key = trade.commissionAsset
    result.commissions[key] = (result.commissions[key] ?? 0) + Number(trade.commission)
    return result
  }, {
    buyTrades: 0,
    sellTrades: 0,
    buyQuantity: 0,
    sellQuantity: 0,
    buyQuote: 0,
    sellQuote: 0,
    commissions: {},
  })

  console.log("\\nSummary (display totals only; retain raw rows for exact reconciliation):")
  console.log(JSON.stringify({
    returnedTrades: trades.length,
    requestedLimit: limit,
    ...totals,
    netBaseQuantityBeforeCommission: totals.buyQuantity - totals.sellQuantity,
    quoteDifferenceBeforeCommission: totals.sellQuote - totals.buyQuote,
  }, null, 2))
  console.log("\\nNote: Binance myTrades is bounded by the requested limit. Run with a time-bounded trade-ID range or paginate if the incident exceeds the returned window.")
}

main().catch((error) => {
  console.error("\\nFailed to retrieve TESTNET trade history:")
  console.error(error.message)
  process.exitCode = 1
})
