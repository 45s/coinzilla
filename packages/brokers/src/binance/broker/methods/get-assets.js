import {
  generateSignQuery,
  generateSignature,
  send,
  adaptSpotAsset,
} from "../../shared/index.js"

export const getAssets = async () => {
  const query = generateSignQuery()
  const r = await send({
    path: `account?${query}&signature=${generateSignature(query)}`,
  })
  if ("msg" in r) {
    console.error(r)
    throw new Error(r.msg)
  }
  return adaptSpotAsset(r.balances)
}
