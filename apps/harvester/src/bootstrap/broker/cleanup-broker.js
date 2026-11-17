import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapBrokerDisconnectedData } from "../../application/events/lifecycle-event-dtos.js"

export async function stopMarketIntake({ subscriptions = [], bookSubscriptions = [] } = {}) {
  const operations = [
    ...bookSubscriptions.map(({ unsubscribe }) => () => unsubscribe()),
    ...subscriptions.map(({ unsubscribe }) => () => unsubscribe()),
  ]
  const results = await Promise.allSettled(operations.map((operation) =>
    Promise.resolve().then(operation)))
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
}

export async function stopUserDataIntake({ userDataSubscription } = {}) {
  if (typeof userDataSubscription?.disconnect !== "function") {
    return []
  }
  const result = await Promise.allSettled([
    Promise.resolve().then(() => userDataSubscription.disconnect()),
  ])
  return result
    .filter((entry) => entry.status === "rejected")
    .map((entry) => entry.reason)
}

async function stopBrokerIntake({ subscriptions, bookSubscriptions = [], userDataSubscription }) {
  const [marketErrors, userDataErrors] = await Promise.all([
    stopMarketIntake({
      subscriptions,
      bookSubscriptions,
    }),
    stopUserDataIntake({
      userDataSubscription,
    }),
  ])
  return [...marketErrors, ...userDataErrors]
}

export async function disconnectBroker({ broker, brokerName, eventPublisher, disconnectAll }) {
  const disconnectOperation = typeof disconnectAll === "function"
    ? disconnectAll
    : () => broker.disconnect()
  const results = await Promise.allSettled([
    Promise.resolve().then(disconnectOperation),
  ])
  const [brokerDisconnect] = results
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
    dataResult: mapBrokerDisconnectedData({
      broker: brokerName,
      outcome: brokerDisconnect.status === "fulfilled" ? "success" : "failed",
      ...(brokerDisconnect.status === "rejected" ? { error: brokerDisconnect.reason } : {}),
    }),
  })
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
}

export async function cleanupBroker({
  broker,
  brokerName,
  eventPublisher,
  subscriptions,
  bookSubscriptions = [],
  userDataSubscription,
  disconnectAll,
} = {}) {
  const intakeErrors = await stopBrokerIntake({
    subscriptions,
    bookSubscriptions,
    userDataSubscription,
  })
  const disconnectErrors = await disconnectBroker({
    broker,
    brokerName,
    eventPublisher,
    disconnectAll,
  })
  return [...intakeErrors, ...disconnectErrors]
}
