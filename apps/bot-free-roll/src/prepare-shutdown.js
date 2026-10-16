export async function prepareShutdown({ tradingConnection, marketConnection }) {
  async function startShutdown() {
    console.log("\n[bot] Shutting down...")

    await Promise.allSettled([
      tradingConnection?.disconnect(),
      marketConnection?.disconnect(),
    ])
  }

  return {
    startShutdown,
  }
}
