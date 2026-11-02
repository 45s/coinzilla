/**
 * Create an independent serial promise queue for each key.
 * Tasks with the same key run in enqueue order; different keys run concurrently.
 *
 * Task failures are passed to the optional onError callback. A failure in
 * onError rejects that enqueue result but never poisons later tasks for the key.
 */
export function createKeyedQueue(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object")
  }
  const { onError } = options

  if (onError !== undefined && typeof onError !== "function") {
    throw new TypeError("onError must be a function")
  }

  const queues = new Map()

  function enqueue({ key, task } = {}) {
    if (key === undefined) throw new TypeError("key is required")
    if (typeof task !== "function") throw new TypeError("task must be a function")

    const previous = queues.get(key) ?? Promise.resolve()
    const execution = previous.then(task).catch((error) => {
      if (!onError) throw error
      return onError({ key, error })
    })

    let tail
    tail = execution
      .catch(() => undefined)
      .finally(() => {
        if (queues.get(key) === tail) queues.delete(key)
      })

    queues.set(key, tail)
    return execution
  }

  async function drain() {
    await Promise.all([...queues.values()])
  }

  return Object.freeze({ enqueue, drain })
}
