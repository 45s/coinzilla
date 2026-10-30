import { isProdMode, isTestingMode } from './environment-mode.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    crimson: '\x1b[38m',
  },
  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m',
    gray: '\x1b[100m',
    crimson: '\x1b[48m',
  },
}

const levelColorsMap = {
  info: [colors.fg.blue],
  system: [colors.fg.cyan, colors.bright],
  debug: [colors.fg.magenta, colors.bright],
  error: [colors.fg.red],
  warn: [colors.fg.yellow],
  success: [colors.fg.green],
}

const formatContent = (data) => {
  if (['string', 'number', 'boolean'].some((type) => typeof data === type)) {
    return data
  }

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 *
 * @param {*} input
 * @param {{
 * isUseJsonStringify:  boolean
 * level: 'info' | 'system' | 'error' | 'warn' | 'success'
 * }} options
 * @returns
 */
function createLog(input, { level = 'info' } = {}) {
  const timestamp = [colors.fg.gray, new Date().toLocaleTimeString()]
  console.log(...timestamp, ...levelColorsMap[level], formatContent(input), colors.reset)
}

export class Logger {
  debug(data) {
    if (isProdMode) {
      return
    }
    createLog(data, { level: 'debug' })
  }
  info(data) {
    createLog(data, { level: 'info' })
  }
  warn(data) {
    if (isTestingMode) {
      return
    }
    createLog(data, { level: 'warn' })
  }
  error(data) {
    createLog(data, { level: 'error' })
  }
  success(data) {
    createLog(data, { level: 'success' })
  }
  system(data) {
    createLog(data, { level: 'system' })
  }
}

export const defaultLogger = new Logger()
