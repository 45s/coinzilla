import { once } from "node:events"

/**
 * Forward child-process output to durable destinations and optional
 * best-effort destinations.
 *
 * Durable destinations apply backpressure before the source is read again.
 * Best-effort destinations never pause the source: once a destination reports
 * backpressure, subsequent chunks are skipped until it drains.
 *
 * @param {{
 *   source: NodeJS.ReadableStream,
 *   destinations: () => NodeJS.WritableStream[],
 *   bestEffortDestinations?: () => NodeJS.WritableStream[],
 * }} input
 * @returns {Promise<number>} Number of chunks skipped by best-effort destinations.
 */
export async function forwardChildOutput({
  source,
  destinations,
  bestEffortDestinations = () => [],
} = {}) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw new TypeError("source must be an async-iterable readable stream")
  }
  if (typeof destinations !== "function") {
    throw new TypeError("destinations must be a function")
  }
  if (typeof bestEffortDestinations !== "function") {
    throw new TypeError("bestEffortDestinations must be a function")
  }

  let droppedChunks = 0

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

    for (const destination of bestEffortDestinations()) {
      if (!destination || destination.destroyed || destination.writableEnded) continue
      if (destination.writableNeedDrain) {
        droppedChunks += 1
        continue
      }

      try {
        destination.write(chunk)
      } catch {
        // Terminal display is optional; a failed display must not stop capture.
        droppedChunks += 1
      }
    }
  }

  return droppedChunks
}
