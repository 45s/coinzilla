/** Infrastructure adapter around Node timers; replaceable with a virtual clock in tests. */
export class TimeoutScheduler {
  constructor({ setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
      throw new TypeError("Timer dependencies must be functions")
    }
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
  }

  /**
   * Keep the callback/delay call contract while accepting the pair as one rest parameter.
   * @param {...[Function, number]} parameters
   */
  schedule(...parameters) {
    const [callback, delay] = parameters
    return this.setTimeoutFn(callback, delay)
  }

  cancel(handle) {
    this.clearTimeoutFn(handle)
  }
}
