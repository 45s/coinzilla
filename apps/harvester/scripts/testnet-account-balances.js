export const normalizeAccountBalances = ({ balances }) => {
  if (!Array.isArray(balances)) {
    throw new Error("Account balances must be an array")
  }

  return {
    balances: balances.map((balance) => {
      if (
        !balance ||
        typeof balance.asset !== "string" ||
        balance.asset.length === 0 ||
        typeof balance.free !== "string" ||
        typeof balance.locked !== "string" ||
        !Number.isFinite(Number(balance.free)) ||
        !Number.isFinite(Number(balance.locked)) ||
        Number(balance.free) < 0 ||
        Number(balance.locked) < 0
      ) {
        throw new Error("Binance TESTNET returned an invalid asset balance")
      }

      return {
        asset: balance.asset,
        free: balance.free,
        locked: balance.locked,
      }
    }),
  }
}

export const getNonZeroBalances = ({ balances }) => {
  const { balances: normalizedBalances } = normalizeAccountBalances({ balances })

  return {
    balances: normalizedBalances.filter(
      ({ free, locked }) => Number(free) > 0 || Number(locked) > 0,
    ),
  }
}
