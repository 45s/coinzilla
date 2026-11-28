import { createTradingSessionRecord } from "../domain/trading-session/trading-session.js"
import { mapTradingSessionInput } from "../application/trading-session/trading-session-input.js"
import { assertTradingSessionRepository } from "../application/ports/trading-session-repository.js"

export async function createTradingSession({ repository, session } = {}) {
  assertTradingSessionRepository({ repository })
  const record = createTradingSessionRecord({
    ...session,
    ...mapTradingSessionInput(session),
  })
  return repository.create(record)
}
