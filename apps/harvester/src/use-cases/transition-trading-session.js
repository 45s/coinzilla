import { assertTradingSessionRepository } from "../application/ports/trading-session-repository.js"

export async function transitionTradingSession({ repository, id, status, endedAt } = {}) {
  assertTradingSessionRepository({ repository })
  return repository.transition({
    id,
    status,
    ...(endedAt === undefined ? {} : { endedAt }),
  })
}
