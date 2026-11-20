function requireString({ value, field }) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw new TypeError(`History-sync cursor ${field} must be a non-empty string`)
  }
  return value
}

function requireCursor({ value, field }) {
  if (value === null || value === undefined) {
    return null
  }
  const cursor = requireString({
    value: String(value),
    field,
  })
  if (!/^\d+$/.test(cursor)) {
    throw new TypeError(`History-sync cursor ${field} must contain only decimal digits`)
  }
  return cursor
}

function resolveCursorIdentity({ providerIdentity, environment, symbol }) {
  const providerType = requireString({
    value: providerIdentity?.providerType,
    field: "providerType",
  })
  const providerInstanceId = requireString({
    value: providerIdentity?.providerInstanceId,
    field: "providerInstanceId",
  })
  const accountId = requireString({
    value: providerIdentity?.accountId,
    field: "accountId",
  })
  const tradingEnvironment = requireString({
    value: environment,
    field: "environment",
  })
  if (!["testnet", "live"].includes(tradingEnvironment)) {
    throw new TypeError("History-sync cursor environment must be testnet or live")
  }
  const marketSymbol = requireString({
    value: symbol,
    field: "symbol",
  })
  return {
    id: JSON.stringify([
      tradingEnvironment,
      providerInstanceId,
      providerType,
      accountId,
      marketSymbol,
    ]),
    providerType,
    providerInstanceId,
    accountId,
    environment: tradingEnvironment,
    symbol: marketSymbol,
  }
}

function readCursor({ database, identity }) {
  const row = database.prepare(
    "SELECT last_order_id, last_trade_id FROM history_sync_cursors WHERE id = ?",
  ).get(identity.id)
  return {
    lastOrderId: row?.last_order_id ?? null,
    lastTradeId: row?.last_trade_id ?? null,
  }
}

function saveCursor({
  database,
  identity,
  cursorColumn,
  cursorValue,
  updatedAt,
}) {
  const value = requireCursor({
    value: cursorValue,
    field: cursorColumn,
  })
  const timestamp = requireString({
    value: updatedAt,
    field: "updatedAt",
  })
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    throw new TypeError("History-sync cursor updatedAt must be canonical UTC ISO-8601")
  }
  const insert = database.prepare(`
    INSERT INTO history_sync_cursors (
      id, provider_type, provider_instance_id, account_id, environment,
      symbol, last_order_id, last_trade_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ${cursorColumn} = excluded.${cursorColumn},
      updated_at = excluded.updated_at
  `)
  insert.run(
    identity.id,
    identity.providerType,
    identity.providerInstanceId,
    identity.accountId,
    identity.environment,
    identity.symbol,
    cursorColumn === "last_order_id" ? value : null,
    cursorColumn === "last_trade_id" ? value : null,
    timestamp,
  )
}

export function createHistorySyncCursorRepository({ database } = {}) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("History-sync cursor persistence requires a connected SQLite database")
  }
  return Object.freeze({
    get: async ({ providerIdentity, environment, symbol } = {}) => {
      const identity = resolveCursorIdentity({
        providerIdentity,
        environment,
        symbol,
      })
      return readCursor({
        database,
        identity,
      })
    },
    saveOrderCursor: async ({ providerIdentity, environment, symbol, lastOrderId, updatedAt } = {}) => {
      const identity = resolveCursorIdentity({
        providerIdentity,
        environment,
        symbol,
      })
      saveCursor({
        database,
        identity,
        cursorColumn: "last_order_id",
        cursorValue: lastOrderId,
        updatedAt,
      })
    },
    saveTradeCursor: async ({ providerIdentity, environment, symbol, lastTradeId, updatedAt } = {}) => {
      const identity = resolveCursorIdentity({
        providerIdentity,
        environment,
        symbol,
      })
      saveCursor({
        database,
        identity,
        cursorColumn: "last_trade_id",
        cursorValue: lastTradeId,
        updatedAt,
      })
    },
  })
}
