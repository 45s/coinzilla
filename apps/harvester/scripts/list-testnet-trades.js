import { getMyTrades } from "./binance-testnet-api.js"
import {
  normalizeTradeHistory,
  parseTradeHistoryArguments,
} from "./testnet-trade-history-utils.js"

const main = async () => {
  const { symbol, limit, fromId } = parseTradeHistoryArguments({
    args: process.argv.slice(2),
  })
  const { trades: responseTrades } = await getMyTrades({ symbol, limit, fromId })
  const { trades } = normalizeTradeHistory({ trades: responseTrades })

  console.log(`\nBinance Spot TESTNET — Actual Trades: ${symbol}\n`)

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

  console.log(`\nReturned trades: ${trades.length} (requested limit: ${limit}, fromId: ${fromId ?? "not set"})`)
  console.log("Keep these raw rows for exact commission and inventory reconciliation.")

}

main().catch((error) => {
  console.error("\nFailed to retrieve TESTNET trade history:")
  console.error(error.message)
  process.exitCode = 1
})
