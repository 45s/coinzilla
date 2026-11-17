const KEYBOARD_ACTIONS = Object.freeze({
  pause: Object.freeze({ type: "PAUSE_MENU" }),
  resume: Object.freeze({ type: "RESUME_MENU" }),
  status: Object.freeze({ type: "STATUS" }),
  markets: Object.freeze({ type: "MARKETS" }),
  portfolio: Object.freeze({ type: "POSITIONS" }),
  "open orders": Object.freeze({ type: "ORDERS" }),
})

const ENTRY_COMMAND_TYPES = Object.freeze({
  "/start": "START",
  "/menu": "MENU",
  "/help": "HELP",
})
const READ_ONLY_COMMAND_TYPES = Object.freeze({
  "/status": "STATUS",
  "/markets": "MARKETS",
  "/positions": "POSITIONS",
  "/orders": "ORDERS",
  "/balances": "BALANCES",
})
const GLOBAL_BUY_COMMAND_TYPES = Object.freeze({
  "/pauseallbuys": "PAUSE_ALL_BUYS",
  "/resumeallbuys": "RESUME_ALL_BUYS",
})
const MARKET_SYMBOL_PATTERN = /^[A-Za-z0-9]{2,30}$/

export function parseEntryCommand({ command, argumentsList }) {
  const type = ENTRY_COMMAND_TYPES[command]
  if (!type) { return undefined }
  if (argumentsList.length !== 0) { return Object.freeze({ type: "INVALID" }) }
  return Object.freeze({ type })
}


function parseReadOnlyCommand({ command, argumentsList } = {}) {
  const type = READ_ONLY_COMMAND_TYPES[command]
  if (!type) {
    return undefined
  }
  if (argumentsList.length !== 0) {
    return Object.freeze({
      type: "INVALID",
      command: command.slice(1).toUpperCase(),
    })
  }
  return Object.freeze({ type })
}

function parseEmergencyBuyCommand({ command, argumentsList } = {}) {
  const globalType = GLOBAL_BUY_COMMAND_TYPES[command]
  if (globalType) {
    if (argumentsList.length !== 0) {
      return Object.freeze({
        type: "INVALID",
        command: command.slice(1).toUpperCase(),
      })
    }
    return Object.freeze({ type: globalType })
  }
  if (command !== "/pausebuys" && command !== "/resumebuys") {
    return undefined
  }
  if (argumentsList.length !== 1 || !MARKET_SYMBOL_PATTERN.test(argumentsList[0])) {
    return Object.freeze({
      type: "INVALID",
      command: command.slice(1).toUpperCase(),
    })
  }
  return Object.freeze({
    type: command === "/pausebuys" ? "PAUSE_BUYS" : "RESUME_BUYS",
    symbol: argumentsList[0].toUpperCase(),
  })
}

function parseMarketPauseCommand({ command, argumentsList } = {}) {
  if (command !== "/pause" && command !== "/resume") {
    return undefined
  }
  if (argumentsList.length !== 1 || !MARKET_SYMBOL_PATTERN.test(argumentsList[0])) {
    return Object.freeze({
      type: "INVALID",
      command: command.slice(1).toUpperCase(),
    })
  }
  return Object.freeze({
    type: command === "/pause" ? "PAUSE" : "RESUME",
    symbol: argumentsList[0].toUpperCase(),
  })
}

export function getInvalidCommandUsage(command) {
  const normalizedCommand = String(command ?? "command").toLowerCase()
  if (["PAUSEBUYS", "RESUMEBUYS", "PAUSE", "RESUME"].includes(command)) {
    return `Usage: /${normalizedCommand} <SYMBOL>. Use /help for commands.`
  }
  return `Usage: /${normalizedCommand} with no arguments. Use /help for commands.`
}

/**
 * Parse the deliberately small initial Telegram command vocabulary.
 *
 * @param {string} text - Telegram message text.
 * @param {object} [options]
 * @param {string} [options.botUsername] - Username returned by Telegram getMe.
 * @returns {{type: string, symbol?: string}} Transport-neutral parse result.
 */
export function parseTelegramOperatorCommand(...args) {
  const [text, { botUsername } = {}] = args
  if (typeof text !== "string" || text.trim() === "") {
    return Object.freeze({ type: "IGNORE" })
  }
  const normalizedText = text.trim()
  if (!normalizedText.startsWith("/")) {
    return KEYBOARD_ACTIONS[normalizedText.toLowerCase()] ?? Object.freeze({ type: "IGNORE" })
  }

  const [commandToken, ...argumentsList] = normalizedText.split(/\s+/)
  const commandParts = commandToken.split("@")
  if (commandParts.length > 2) {
    return Object.freeze({ type: "INVALID" })
  }
  const [command, targetUsername] = commandParts
  if (targetUsername !== undefined &&
      (typeof botUsername !== "string" || targetUsername.toLowerCase() !== botUsername.toLowerCase())) {
    return Object.freeze({ type: "IGNORE" })
  }
  const entryCommand = parseEntryCommand({
    command,
    argumentsList,
  })
  if (entryCommand) {
    return entryCommand
  }
  return parseReadOnlyCommand({
    command,
    argumentsList,
  }) ?? parseEmergencyBuyCommand({
    command,
    argumentsList,
  }) ?? parseMarketPauseCommand({
    command,
    argumentsList,
  }) ?? Object.freeze({ type: "UNSUPPORTED" })
}
