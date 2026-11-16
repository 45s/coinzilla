import { Console } from "node:console"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

import {
  binanceTestnetPublicRequest,
  binanceTestnetRequest,
  getAccountBalances,
  getOpenOrders,
} from "./binance-testnet-api.js"
import { getMarketSellQuantity } from "./testnet-sell-utils.js"

const cliConsole = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
})

const SYMBOL = "ZROUSDT"
const ASSET = "ZRO"
const CONFIRMATION = "SELL ALL FREE ZRO ON TESTNET"

const getFreeZroBalance = ({ balances }) => {
  const balance = balances.find(({ asset }) => asset === ASSET)

  if (!balance || typeof balance.free !== "string") {
    throw new Error(`Binance TESTNET did not return a valid ${ASSET} balance`)
  }

  return balance.free
}

const getSymbolInfo = async () => {
  const { data } = await binanceTestnetPublicRequest({
    method: "GET",
    path: "/api/v3/exchangeInfo",
    params: { symbol: SYMBOL },
  })

  if (!data || !Array.isArray(data.symbols)) {
    throw new Error("Binance TESTNET returned invalid exchange information")
  }

  const symbolInfo = data.symbols.find(({ symbol }) => symbol === SYMBOL)

  if (
    !symbolInfo ||
    symbolInfo.status !== "TRADING" ||
    symbolInfo.isSpotTradingAllowed === false
  ) {
    throw new Error(`${SYMBOL} is not available for Spot trading`)
  }

  return { symbolInfo }
}

const assertNoOpenOrders = async () => {
  const { orders } = await getOpenOrders()
  const symbolOrders = orders.filter(({ symbol }) => symbol === SYMBOL)

  if (symbolOrders.length > 0) {
    cliConsole.table(
      symbolOrders.map((order) => ({
        orderId: order.orderId,
        side: order.side,
        type: order.type,
        price: order.price,
        quantity: order.origQty,
        executed: order.executedQty,
        status: order.status,
      })),
    )

    throw new Error(
      `Found ${symbolOrders.length} open ${SYMBOL} order(s). Stop trading processes and inspect/cancel them before selling.`,
    )
  }
}

const askForConfirmation = async () => {
  const readline = createInterface({ input: stdin,
output: stdout })

  try {
    const answer = await readline.question(
      `Type "${CONFIRMATION}" to place the market sell: `,
    )

    return answer.trim() === CONFIRMATION
  } finally {
    readline.close()
  }
}

const main = async () => {
  cliConsole.log("\nBinance Spot TESTNET — Sell All Free ZRO at Market\n")

  await assertNoOpenOrders()

  const [{ balances }, { symbolInfo }] = await Promise.all([
    getAccountBalances(),
    getSymbolInfo(),
  ])

  const freeBalance = getFreeZroBalance({ balances })
  const { quantity, stepSize } = getMarketSellQuantity({
    freeBalance,
    symbolInfo,
  })

  cliConsole.log("========== MARKET SELL PREVIEW ==========")
  cliConsole.log(`Environment:  Binance Spot TESTNET`)
  cliConsole.log(`Symbol:       ${SYMBOL}`)
  cliConsole.log("Side:         SELL")
  cliConsole.log("Order type:   MARKET")
  cliConsole.log(`Free balance: ${freeBalance} ${ASSET}`)
  cliConsole.log(`Sell amount:  ${quantity} ${ASSET}`)
  cliConsole.log(`Step size:    ${stepSize}`)
  cliConsole.log("=========================================")
  cliConsole.log("\nOnly free ZRO is included. Locked ZRO is not sold.")
  cliConsole.log("A market order does not guarantee a specific execution price.")

  const confirmed = await askForConfirmation()

  if (!confirmed) {
    cliConsole.log("\nConfirmation did not match. No order was placed.")
    return
  }

  // Re-read the account immediately before submission. Never silently sell a
  // different amount from the one the operator explicitly confirmed.
  await assertNoOpenOrders()

  const { balances: refreshedBalances } = await getAccountBalances()
  const refreshedFreeBalance = getFreeZroBalance({
    balances: refreshedBalances,
  })
  const refreshed = getMarketSellQuantity({
    freeBalance: refreshedFreeBalance,
    symbolInfo,
  })

  if (refreshed.quantity !== quantity) {
    throw new Error(
      `Free ZRO balance changed after confirmation (preview: ${quantity}, current: ${refreshed.quantity}). Nothing was sold; run the preview again.`,
    )
  }

  cliConsole.log("\nSubmitting MARKET SELL...")

  const { data: order } = await binanceTestnetRequest({
    method: "POST",
    path: "/api/v3/order",
    params: {
      symbol: SYMBOL,
      side: "SELL",
      type: "MARKET",
      quantity,
      newOrderRespType: "FULL",
    },
  })

  cliConsole.log("\n========== MARKET SELL RESULT ==========")
  cliConsole.log(`Order ID:          ${order.orderId}`)
  cliConsole.log(`Status:            ${order.status}`)
  cliConsole.log(`Requested:         ${quantity} ${ASSET}`)
  cliConsole.log(`Executed:          ${order.executedQty} ${ASSET}`)
  cliConsole.log(`Quote received:    ${order.cummulativeQuoteQty} USDT`)
  cliConsole.log(`Fills:             ${order.fills?.length ?? 0}`)
  if (Array.isArray(order.fills)) {
    cliConsole.table(
      order.fills.map((fill) => ({
        price: fill.price,
        quantity: fill.qty,
        commission: fill.commission,
        commissionAsset: fill.commissionAsset,
      })),
    )
  }
  cliConsole.log("========================================")
}

main().catch((error) => {
  cliConsole.error("\nFailed to sell free ZRO on Binance TESTNET:")
  cliConsole.error(error.message)
  process.exitCode = 1
})
