async function disconnectSubscription({ subscription }) {
  if (typeof subscription?.disconnect === "function") {
    await subscription.disconnect()
  } else if (typeof subscription?.close === "function") {
    await subscription.close()
  } else if (typeof subscription?.unsubscribe === "function") {
    await subscription.unsubscribe()
  }
}

export function createKeyedQueue({ onError } = {}) {
  const queues = new Map()

  function enqueue({ key, task }) {
    const previous = queues.get(key) ?? Promise.resolve()

    const next = previous
      .then(task)
      .catch((error) => {
        onError?.({ key, error })
      })
      .finally(() => {
        if (queues.get(key) === next) {
          queues.delete(key)
        }
      })

    queues.set(key, next)
    return next
  }

  async function drain() {
    await Promise.all([...queues.values()])
  }

  return { enqueue, drain }
}

export async function disconnectSubscriptions({ subscriptions }) {
  const results = await Promise.allSettled(
    subscriptions
      .filter(Boolean)
      .map((subscription) => disconnectSubscription({ subscription })),
  )

  return { results }
}
