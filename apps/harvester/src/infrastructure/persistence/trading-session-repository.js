export function createTradingSessionRepository() {
  const notImplemented = () => {
    throw new Error("Trading-session repository behavior is not implemented")
  }
  return Object.freeze({
    create: notImplemented,
    findById: notImplemented,
    transition: notImplemented,
  })
}
