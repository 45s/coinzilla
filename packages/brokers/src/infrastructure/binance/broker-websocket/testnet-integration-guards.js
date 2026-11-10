export function isTestnetOrderMutationEnabled(env = process.env) {
  return env.BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS === "1"
}
