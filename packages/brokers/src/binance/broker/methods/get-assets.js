import { Coin } from "@coinzilla/entities"
import {
  generateSignQuery,
  generateSignature,
  send,
} from "../../shared/index.js"

const EARN_SYMBOL_PREFIX = "LD"

const adaptSpotBalances = (input) => {
  const balances = []
  for (const { asset, free, locked } of input) {
    const quantity = Number(free) + Number(locked)
    if (!quantity) {
      continue
    }
    const ticker = asset.startsWith(EARN_SYMBOL_PREFIX)
      ? asset.replace(EARN_SYMBOL_PREFIX, "")
      : asset
    balances.push(new Coin({ quantity, ticker }).value)
  }
  return balances
}

export const getAssets = async () => {
  const query = generateSignQuery()
  const r = await send({
    path: `account?${query}&signature=${generateSignature(query)}`,
  })
  if ("msg" in r) {
    console.error(r)
    throw new Error(r.msg)
  }
  return adaptSpotBalances(r.balances)
}
