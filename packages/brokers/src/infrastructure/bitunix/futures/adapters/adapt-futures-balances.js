import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { addDecimal, ensure } from "@coinzilla/utils"

/**
 * Convert one Bitunix USDT Futures margin-account row into the shared Balance.
 * Order-frozen funds and position margin are both locked; bonus is not custody.
 *
 * @param {{rows: object[], marginCoin: string}} input
 * @returns {Balance[]}
 */
export function adaptFuturesBalances({ rows, marginCoin } = {}) {
  ensure.array({
    value: rows,
    name: "accountRows",
  })
  ensure.nonEmptyString({
    value: marginCoin,
    name: "marginCoin",
  })
  let account
  for (const row of rows) {
    ensure.plainObject({
      value: row,
      name: "accountRow",
    })
    const rowMarginCoin = ensure.nonEmptyString({
      value: row.marginCoin,
      name: "accountRow.marginCoin",
    })
    if (rowMarginCoin !== marginCoin) {
      continue
    }
    if (account !== undefined) {
      throw new TypeError(`Bitunix Futures account response contains duplicate ${marginCoin} margin accounts`)
    }
    account = row
  }
  if (account === undefined) {
    throw new TypeError(`Bitunix Futures account response does not contain ${marginCoin} margin account`)
  }

  const available = ensure.nonEmptyString({
    value: account.available,
    name: "account.available",
  })
  const frozen = ensure.nonEmptyString({
    value: account.frozen,
    name: "account.frozen",
  })
  const margin = ensure.nonEmptyString({
    value: account.margin,
    name: "account.margin",
  })
  const asset = new Asset({
    id: marginCoin.toLowerCase(),
    code: marginCoin,
  })
  const locked = addDecimal({
    left: frozen,
    right: margin,
  })
  return [new Balance({
    free: new Quantity({
      amount: available,
      asset,
    }),
    locked: new Quantity({
      amount: locked,
      asset,
    }),
  })]
}
