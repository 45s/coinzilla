export function assertBitunixOperatorInteractiveTerminal({ stdin, stdout } = {}) {
  if (stdin?.isTTY !== true || stdout?.isTTY !== true) {
    throw new Error("Bitunix LIVE order attempt requires an interactive terminal; non-interactive execution is refused")
  }
}

export function assertBitunixMutationBroker({ broker }) {
  const requiredMethods = ["connect", "createOrder", "disconnect"]
  if (!broker || requiredMethods.some((method) => typeof broker[method] !== "function")) {
    throw new TypeError("Bitunix operator attempt requires a mutation Broker with createOrder()")
  }
}

export function assertBitunixOperatorAttemptDependencies({
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  writeLine,
}) {
  const requiredReadMethods = [
    "connect",
    "getExchangeMarkets",
    "getSymbolFilters",
    "getBalances",
    "getOpenOrders",
    "disconnect",
  ]
  if (!readBroker || requiredReadMethods.some((method) => typeof readBroker[method] !== "function")) {
    throw new TypeError("Bitunix operator attempt requires a read Broker with market, balance, and open-order queries")
  }
  for (const [name, dependency] of [
    ["createOrderBroker", createOrderBroker],
    ["confirm", confirm],
    ["createMarker", createMarker],
    ["writeLine", writeLine],
  ]) {
    if (typeof dependency !== "function") {
      throw new TypeError(`Bitunix operator attempt requires ${name}()`)
    }
  }
}
