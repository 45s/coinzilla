export async function prepareShutdown({
  tradingConnection,
  marketConnection,
  bot,
}) {
  async function startShutdown() {
    console.log("\n[bot] Shutting down...")

    await Promise.allSettled([
      tradingConnection?.disconnect(),
      marketConnection?.disconnect(),
      bot?.stop(),
    ])
  }

  return {
    startShutdown,
  }
}
