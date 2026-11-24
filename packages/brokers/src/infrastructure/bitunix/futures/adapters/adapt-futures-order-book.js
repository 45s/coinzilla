import { assertDecimalString, compareDecimal, ensure } from "@coinzilla/utils"

function adaptDepthSide({ levels, side }) {
  ensure.array({
    value: levels,
    name: `orderBook.${side}`,
  })
  const adapted = []
  let previousPrice
  for (const level of levels) {
    ensure.array({
      value: level,
      name: `orderBook.${side} level`,
    })
    if (level.length !== 2) {
      throw new TypeError(`Bitunix Futures ${side} depth level must contain price and quantity`)
    }
    const [price, quantity] = level
    assertDecimalString({
      value: price,
      field: `Bitunix Futures ${side} price`,
    })
    assertDecimalString({
      value: quantity,
      field: `Bitunix Futures ${side} quantity`,
    })
    if (compareDecimal({
      left: price,
      right: "0",
    }) <= 0 || compareDecimal({
      left: quantity,
      right: "0",
    }) <= 0) {
      throw new RangeError(`Bitunix Futures ${side} price and quantity must be positive`)
    }
    if (previousPrice !== undefined) {
      const comparison = compareDecimal({
        left: previousPrice,
        right: price,
      })
      const outOfOrder = side === "asks"
        ? comparison >= 0
        : comparison <= 0
      if (outOfOrder) {
        throw new TypeError(`Bitunix Futures ${side} depth levels are not strictly price-ordered`)
      }
    }
    adapted.push(Object.freeze([price, quantity]))
    previousPrice = price
  }
  return Object.freeze(adapted)
}

/**
 * Adapt one public Bitunix Futures depth response without converting exact
 * price or quantity strings through JavaScript Number.
 *
 * @param {{data: object, symbol: string}} input
 * @returns {{symbol: string, asks: string[][], bids: string[][]}}
 */
export function adaptFuturesOrderBook({ data, symbol } = {}) {
  ensure.plainObject({
    value: data,
    name: "orderBook",
  })
  ensure.nonEmptyString({
    value: symbol,
    name: "symbol",
  })
  return Object.freeze({
    symbol,
    asks: adaptDepthSide({
      levels: data.asks,
      side: "asks",
    }),
    bids: adaptDepthSide({
      levels: data.bids,
      side: "bids",
    }),
  })
}
