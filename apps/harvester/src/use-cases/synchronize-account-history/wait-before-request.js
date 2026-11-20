export async function waitBeforeRequest({ state, requestDelayMs, sleep }) {
  if (state.requestCount > 0 && requestDelayMs > 0) {
    await sleep({
      durationMs: requestDelayMs,
    })
  }
}
