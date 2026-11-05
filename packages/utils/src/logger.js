import { isProdMode, isTestingMode } from './environment-mode.js'
import { formatLogContent, normalizeLogData } from './format-log-content.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  fg: {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
  },
}

const LEVELS = Object.freeze(['trace', 'debug', 'info', 'warn', 'error'])
const LEVEL_RANK = Object.freeze(Object.fromEntries(LEVELS.map((level, index) => [level, index])))
const METHOD_LEVEL = Object.freeze({
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  success: 'info',
  system: 'info',
})
const LEVEL_COLORS = Object.freeze({
  trace: [colors.fg.gray, colors.dim],
  debug: [colors.fg.magenta, colors.bright],
  info: [colors.fg.blue],
  warn: [colors.fg.yellow],
  error: [colors.fg.red],
  success: [colors.fg.green],
  system: [colors.fg.cyan, colors.bright],
})

function assertLevel(level) {
  if (typeof level !== 'string' || !Object.hasOwn(LEVEL_RANK, level)) {
    throw new TypeError(`Invalid log level: ${String(level)}. Expected one of: ${LEVELS.join(', ')}`)
  }
  return level
}

function validateTransport(transport) {
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) {
    throw new TypeError('Transport must be an object')
  }
  if (typeof transport.name !== 'string' || transport.name.trim() === '') {
    throw new TypeError('Transport name must be a non-empty string')
  }
  if (typeof transport.write !== 'function') {
    throw new TypeError(`Transport "${transport.name}" must provide write(entry)`)
  }
  assertLevel(transport.level)
  if (transport.close !== undefined && typeof transport.close !== 'function') {
    throw new TypeError(`Transport "${transport.name}" close must be a function`)
  }
}

function createConsoleTransport() {
  return {
    name: 'console',
    level: isProdMode ? 'info' : 'debug',
    shouldWrite: ({ method }) => !(isTestingMode && method === 'warn'),
    write({ timestamp, level, method, data }) {
      console.log(
        colors.fg.gray,
        new Date(timestamp).toLocaleTimeString(),
        ...LEVEL_COLORS[method] ?? LEVEL_COLORS[level],
        formatLogContent(data),
        colors.reset,
      )
    },
  }
}

/**
 * @typedef {object} LogEntry
 * @property {string} timestamp - ISO-8601 timestamp created once per log call.
 * @property {'trace'|'debug'|'info'|'warn'|'error'} level - Standard severity.
 * @property {'trace'|'debug'|'info'|'warn'|'error'|'success'|'system'} method - Called semantic method.
 * @property {*} data - JSON-safe structured data with sensitive fields redacted.
 */

/**
 * @typedef {object} LoggerTransport
 * @property {string} name - Unique transport identifier within this logger.
 * @property {'trace'|'debug'|'info'|'warn'|'error'} level - Minimum severity accepted by this transport.
 * @property {(entry: LogEntry) => (void|Promise<void>)} write - Receives each accepted entry.
 * @property {() => (void|Promise<void>)} [close] - Optional resource cleanup hook.
 */

/**
 * Structured logger with independently filtered output transports.
 *
 * @param {{ transports?: LoggerTransport[], onTransportError?: (context: { transport: string, error: Error }) => (void|Promise<void>) }} [options]
 */
export class Logger {
  constructor({ transports = [createConsoleTransport()], onTransportError } = {}) {
    if (!Array.isArray(transports)) {
      throw new TypeError('Logger transports must be an array')
    }
    if (onTransportError !== undefined && typeof onTransportError !== 'function') {
      throw new TypeError('onTransportError must be a function')
    }

    this.transports = new Map()
    this.onTransportError = onTransportError ?? (({ transport, error }) => {
      console.error('Logger transport failed', { transport, error })
    })

    for (const transport of transports) {
      this.addTransport(transport)
    }
  }

  /**
   * Add a uniquely named transport.
   * @param {LoggerTransport} transport
   * @returns {this}
   * @throws {TypeError} If the transport contract is invalid or its name exists.
   */
  addTransport(transport) {
    validateTransport(transport)
    if (this.transports.has(transport.name)) {
      throw new TypeError(`Transport already exists: ${transport.name}`)
    }
    this.transports.set(transport.name, {
      transport,
      level: transport.level,
    })
    return this
  }

  /**
   * Change one transport's minimum severity without affecting other transports.
   * @param {{ transport: string, level: 'trace'|'debug'|'info'|'warn'|'error' }} options
   * @returns {{ transports: Array<{ name: string, level: string }> }}
   * @throws {TypeError} If the transport identifier is unknown or options are invalid.
   */
  setLevel({ transport, level } = {}) {
    if (typeof transport !== 'string' || transport.trim() === '') {
      throw new TypeError('Transport identifier must be a non-empty string')
    }
    const normalizedLevel = assertLevel(level)
    const configuration = this.transports.get(transport)
    if (!configuration) {
      throw new TypeError(`Unknown transport: ${transport}`)
    }
    configuration.level = normalizedLevel
    return this.getConfig()
  }

  /**
   * Return an immutable snapshot of the current transport configuration.
   * @returns {{ transports: Array<{ name: string, level: string }> }}
   */
  getConfig() {
    return {
      transports: [...this.transports].map(([name, configuration]) => ({
        name,
        level: configuration.level,
      })),
    }
  }

  /**
   * Remove a transport and await its optional cleanup hook.
   * Cleanup failures are reported through onTransportError and do not prevent
   * other transports from being used.
   * @param {string} name
   * @returns {Promise<boolean>} Whether a transport was removed.
   */
  async removeTransport(name) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('Transport identifier must be a non-empty string')
    }
    const configuration = this.transports.get(name)
    if (!configuration) {
      return false
    }
    this.transports.delete(name)
    await this.closeTransport({ name, transport: configuration.transport })
    return true
  }

  /**
   * Close and remove every registered transport.
   * @returns {Promise<void>}
   */
  async close() {
    const transports = [...this.transports]
    this.transports.clear()
    await Promise.all(transports.map(([name, configuration]) =>
      this.closeTransport({ name, transport: configuration.transport }),
    ))
  }

  closeTransport({ name, transport }) {
    if (typeof transport.close !== 'function') {
      return Promise.resolve()
    }
    return Promise.resolve()
      .then(() => transport.close())
      .catch((error) => this.reportTransportError({ transport: name, error }))
  }

  reportTransportError(context) {
    try {
      const result = this.onTransportError(context)
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch((error) => {
          try {
            console.error('Logger transport error handler failed', error)
          } catch {
            // There is no remaining diagnostic channel if stderr is unavailable.
          }
        })
      }
    } catch (error) {
      try {
        console.error('Logger transport error handler failed', error)
      } catch {
        // There is no remaining diagnostic channel if stderr is unavailable.
      }
    }
  }

  log(data, method) {
    const level = METHOD_LEVEL[method]
    const entry = Object.freeze({
      timestamp: new Date().toISOString(),
      level,
      method,
      data: normalizeLogData(data),
    })

    for (const [name, configuration] of this.transports) {
      if (LEVEL_RANK[level] < LEVEL_RANK[configuration.level]) {
        continue
      }

      const { transport } = configuration
      try {
        if (typeof transport.shouldWrite === 'function' && !transport.shouldWrite(entry)) {
          continue
        }
        const result = transport.write(entry)
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch((error) =>
            this.reportTransportError({ transport: name, error }),
          )
        }
      } catch (error) {
        this.reportTransportError({ transport: name, error })
      }
    }
  }

  trace(data) {
    this.log(data, 'trace')
  }

  debug(data) {
    this.log(data, 'debug')
  }

  info(data) {
    this.log(data, 'info')
  }

  warn(data) {
    this.log(data, 'warn')
  }

  error(data) {
    this.log(data, 'error')
  }

  success(data) {
    this.log(data, 'success')
  }

  system(data) {
    this.log(data, 'system')
  }
}

export const defaultLogger = new Logger()
