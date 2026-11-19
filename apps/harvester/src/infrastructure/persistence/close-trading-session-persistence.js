export async function closeTradingSessionPersistence({ observer, database } = {}) {
  const errors = []
  if (observer) {
    try {
      const result = await observer.close()
      if (result?.ok === false) {
        errors.push(...(result.errors ?? [new Error("Trading-session history observer did not flush")]))
      }
    } catch {
      errors.push(new Error("Trading-session history observer close failed"))
    }
  }
  if (database && database.state !== "closed") {
    try {
      await database.close()
    } catch {
      errors.push(new Error("Trading-session history database close failed"))
    }
  }
  return errors
}
