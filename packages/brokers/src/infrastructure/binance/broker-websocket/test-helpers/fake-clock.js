export class FakeClock {
  #now = 0
  #nextId = 1
  #timers = new Map()

  setTimeout(callback, delay = 0) {
    const id = this.#nextId++
    const normalizedDelay = Number.isFinite(Number(delay))
      ? Math.max(0, Number(delay))
      : 0

    this.#timers.set(id, {
      callback,
      dueAt: this.#now + normalizedDelay,
    })

    return id
  }

  clearTimeout(id) {
    this.#timers.delete(id)
  }

  advanceBy(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("FakeClock.advanceBy requires a non-negative duration")
    }

    const target = this.#now + milliseconds

    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) =>
          left[1].dueAt - right[1].dueAt || left[0] - right[0],
        )[0]

      if (!next) break

      const [id, timer] = next
      this.#timers.delete(id)
      this.#now = timer.dueAt
      timer.callback()
    }

    this.#now = target
  }

  get now() {
    return this.#now
  }

  get pendingCount() {
    return this.#timers.size
  }
}
