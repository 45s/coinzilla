export const TESTNET_MENU_ACTIONS = [
  { id: "orders", label: "List open orders", script: "list-testnet-open-orders.js" },
  { id: "cancel-orders", label: "Cancel all open orders", script: "cancel-testnet-open-orders.js" },
  { id: "balances", label: "List account balances", script: "list-testnet-balances.js" },
  { id: "sell-zro", label: "Sell all free ZRO", script: "sell-testnet-zro.js" },
  { id: "history", label: "List order history", script: "list-testnet-order-history.js", prompts: ["symbol", "limit"] },
  { id: "trades", label: "List trades", script: "list-testnet-trades.js", prompts: ["symbol", "limit", "fromId"] },
  { id: "journal-audit", label: "Reconcile journal balances", script: "reconcile-journal-account-balances.js", prompts: ["directory"] },
  { id: "account-audit", label: "Run TESTNET account audit", script: "audit-testnet-account.js" },
  { id: "exit", label: "Exit" },
]

export const PROMPT_DEFAULTS = {
  symbol: { label: "Symbol", value: "ZROUSDT" },
  limit: { label: "Result limit", value: "20" },
  fromId: { label: "Starting trade ID (optional)", value: "" },
  directory: { label: "Journal directory (blank uses configured/default directory)", value: "" },
}

export const buildTestnetMenuArguments = ({ actionId, answers = {} }) => {
  switch (actionId) {
    case "history":
      return [answers.symbol || "ZROUSDT", answers.limit || "20"]
    case "trades":
      return [
        answers.symbol || "DOGEUSDT",
        answers.limit || "1000",
        ...(answers.fromId ? [answers.fromId] : []),
      ]
    case "journal-audit":
      return answers.directory ? [answers.directory] : []
    default:
      return []
  }
}

export const normalizePromptAnswer = (answer, fallback = "") => (
  (answer ?? "").trim() || fallback
)
