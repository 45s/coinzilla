import { Console } from "node:console"
import { getMyTrades } from "./binance-testnet-api.js"
import {
  normalizeTradeHistory,
  parseTradeHistoryArguments,
} from "./testnet-trade-history-utils.js"

const cliConsole = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
})

const main = async () => {
  const { symbol, limit, fromId } = parseTradeHistoryArguments({
    args: process.argv.slice(2),
  })
  const { trades: responseTrades } = await getMyTrades({ symbol,
limit,
fromId })
  const { trades } = normalizeTradeHistory({ trades: responseTrades })

  cliConsole.log(`\nBinance Spot TESTNET — Actual Trades: ${symbol}\n`)

  if (trades.length === 0) {
    cliConsole.log(`No trade history found for ${symbol}.`)
    return
  }

  cliConsole.table(
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

  cliConsole.log(`\nReturned trades: ${trades.length} (requested limit: ${limit}, fromId: ${fromId ?? "not set"})`)
  cliConsole.log("Keep these raw rows for exact commission and inventory reconciliation.")

}

main().catch((error) => {
  cliConsole.error("\nFailed to retrieve TESTNET trade history:")
  cliConsole.error(error.message)
  process.exitCode = 1
})
