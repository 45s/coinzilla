import { once } from "node:events"

/**
 * Forward child-process output to every destination without allowing a slow
 * destination to accumulate an unbounded writable buffer.
 *
 * The source is consumed with async iteration, so it is paused while any
 * destination is applying backpressure. Destinations are resolved per chunk
 * so a failed optional log destination can be removed while forwarding.
 *
 * @param {{ source: NodeJS.ReadableStream, destinations: () => NodeJS.WritableStream[] }} input
 */
export async function forwardChildOutput({ source, destinations } = {}) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw new TypeError("source must be an async-iterable readable stream")
  }
  if (typeof destinations !== "function") {
    throw new TypeError("destinations must be a function")
  }

  for await (const chunk of source) {
    const pendingDrains = []

    for (const destination of destinations()) {
      if (!destination || destination.destroyed || destination.writableEnded) continue
      if (!destination.write(chunk)) {
        pendingDrains.push(once(destination, "drain"))
      }
    }

    if (pendingDrains.length > 0) {
      await Promise.all(pendingDrains)
    }
  }
}
