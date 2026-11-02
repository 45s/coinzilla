async function disconnectSubscription({ subscription }) {
  if (typeof subscription?.disconnect === "function") {
    await subscription.disconnect()
  } else if (typeof subscription?.close === "function") {
    await subscription.close()
  } else if (typeof subscription?.unsubscribe === "function") {
    await subscription.unsubscribe()
  }
}

export async function disconnectSubscriptions({ subscriptions }) {
  const results = await Promise.allSettled(
    subscriptions
      .filter(Boolean)
      .map((subscription) => disconnectSubscription({ subscription })),
  )

  return { results }
}
