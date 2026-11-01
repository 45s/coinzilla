import { EventBus } from "@coinzilla/event-bus"

export function createEventBusAdapter({ logger } = {}) {
  return new EventBus({ logger })
}
