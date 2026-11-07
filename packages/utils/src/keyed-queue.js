/**
 * @template K
 * @typedef {object} KeyedQueueEnqueueOptions
 * @property {K} key - Queue identity; tasks with equal keys are serialized.
 * @property {() => (void|Promise<unknown>)} task - Work to run after earlier work for this key.
 */

/**
 * @template K
 * @typedef {object} KeyedQueueOptions
 * @property {(context: { key: K, error: unknown }) => unknown|Promise<unknown>} [onError]
 */

/**
 * @template K
 * @typedef {object} KeyedQueue
 * @property {(options: KeyedQueueEnqueueOptions<K>) => Promise<unknown>} enqueue
 * @property {() => Promise<void>} drain
 */

/**
 * Create an independent serial promise queue for each key.
 * Tasks with the same key run in enqueue order; different keys run concurrently.
 * Task failures are passed to optional onError. If that callback rejects, the
 * enqueue promise rejects, but later tasks for the key remain runnable.
 *
 * @template K
 * @param {KeyedQueueOptions<K>} [options]
 * @returns {KeyedQueue<K>}
 * @throws {TypeError} If options or onError has an invalid shape.
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

  /** Wait for all tasks pending at the time this method is called. */
  async function drain() {
    await Promise.all([...queues.values()])
  }

  return Object.freeze({ enqueue, drain })
}
