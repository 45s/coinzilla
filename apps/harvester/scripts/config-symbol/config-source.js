import { EXTERNAL_ORDERS_POLICIES } from "../../src/domain/external-orders-policy.js"
import { TRADING_ENVIRONMENTS } from "../../src/domain/trading-environment.js"

function skipQuotedValue(source, startIndex) {
  const quote = source[startIndex]
  let index = startIndex + 1
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2
      continue
    }
    if (source[index] === quote) {
      return index + 1
    }
    if (quote !== "`" && (source[index] === "\n" || source[index] === "\r")) {
      throw new TypeError("CG coin-grabber pairs config contains an unterminated string")
    }
    index += 1
  }
  throw new TypeError("CG coin-grabber pairs config contains an unterminated string")
}

function skipComment(source, startIndex) {
  if (source[startIndex + 1] === "/") {
    let index = startIndex + 2
    while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
      index += 1
    }
    return index
  }
  if (source[startIndex + 1] === "*") {
    const endIndex = source.indexOf("*/", startIndex + 2)
    if (endIndex < 0) {
      throw new TypeError("CG coin-grabber pairs config contains an unterminated block comment")
    }
    return endIndex + 2
  }
  return startIndex
}

function skipTrivia(source, startIndex) {
  let index = startIndex
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    if (source[index] === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipComment(source, index)
      continue
    }
    break
  }
  return index
}

function findTradingPairsObject(source) {
  const matches = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuotedValue(source, index)
      continue
    }
    if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipComment(source, index)
      continue
    }
    if (/[A-Za-z_$]/.test(character)) {
      const identifierStart = index
      index += 1
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        index += 1
      }
      if (source.slice(identifierStart, index) !== "tradingPairs") {
        continue
      }
      const assignmentIndex = skipTrivia(source, index)
      if (source[assignmentIndex] !== "=") {
        continue
      }
      const objectStartIndex = skipTrivia(source, assignmentIndex + 1)
      if (source[objectStartIndex] === "{") {
        matches.push({ identifierStart, objectStartIndex })
      }
      continue
    }
    index += 1
  }

  if (matches.length !== 1) {
    throw new TypeError("CG coin-grabber pairs module must export exactly one tradingPairs object")
  }
  return matches[0]
}

function findMatchingObjectEnd(source, objectStartIndex) {
  let depth = 0
  let index = objectStartIndex
  while (index < source.length) {
    const character = source[index]
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuotedValue(source, index)
      continue
    }
    if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipComment(source, index)
      continue
    }
    if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
    index += 1
  }
  throw new TypeError("CG coin-grabber tradingPairs object is not closed")
}

/**
 * Insert one validated symbol into the dedicated tradingPairs object.
 *
 * @param {{source: string, symbol: string, pairConfig: object}} options - Original module and new pair.
 * @returns {string} Updated JavaScript module source.
 */
export function insertTradingPairConfiguration({ source, symbol, pairConfig } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a JavaScript module string")
  }
  if (typeof symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("symbol must contain 5–20 uppercase ASCII letters or digits")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig) || Object.keys(pairConfig).length === 0) {
    throw new TypeError("pair config must be a non-empty object")
  }

  const { identifierStart, objectStartIndex } = findTradingPairsObject(source)
  const objectEndIndex = findMatchingObjectEnd(source, objectStartIndex)
  const lineStartIndex = source.lastIndexOf("\n", identifierStart - 1) + 1
  const propertyPrefix = source.slice(lineStartIndex, identifierStart)
  if (!/^[\t ]*export const $/.test(propertyPrefix)) {
    throw new TypeError("tradingPairs must be declared as an exported const on its own line")
  }
  const propertyIndent = propertyPrefix.match(/^[\t ]*/)[0]
  const entryIndent = propertyIndent + "  "
  let serialized
  try {
    serialized = JSON.stringify({ [symbol]: pairConfig }, (key, value) => {
      if (key === "tradingEnvironment") {
        const member = Object.entries(TRADING_ENVIRONMENTS).find(([, environment]) => environment === value)?.[0]
        if (!member) {
          throw new TypeError("pair tradingEnvironment must use a supported TRADING_ENVIRONMENTS value")
        }
        return "__TRADING_ENVIRONMENT_" + member + "__"
      }
      if (key === "externalOrdersPolicy" && value !== undefined) {
        const member = Object.entries(EXTERNAL_ORDERS_POLICIES).find(([, policy]) => policy === value)?.[0]
        if (!member) {
          throw new TypeError("pair externalOrdersPolicy must use a supported EXTERNAL_ORDERS_POLICIES value")
        }
        return "__EXTERNAL_ORDERS_POLICY_" + member + "__"
      }
      return value
    }, 2)
    .replace(/"__TRADING_ENVIRONMENT_(BOTH|TESTNET|LIVE)__"/g, "TRADING_ENVIRONMENTS.$1")
    .replace(/"__EXTERNAL_ORDERS_POLICY_(IGNORE|BLOCK)__"/g, "EXTERNAL_ORDERS_POLICIES.$1")
  } catch (cause) {
    throw new TypeError("pair config must be JSON-serializable: " + cause.message, { cause })
  }
  const generatedLines = serialized.split("\n").slice(1, -1).map((line) => entryIndent + line.slice(2))
  generatedLines[generatedLines.length - 1] += ","
  const insertion = "\n" + generatedLines.join("\n")
    + (source[objectStartIndex + 1] === "\n" || source[objectStartIndex + 1] === "\r" ? "" : "\n" + propertyIndent)
  return source.slice(0, objectStartIndex + 1)
    + insertion
    + source.slice(objectStartIndex + 1, objectEndIndex + 1)
    + source.slice(objectEndIndex + 1)
}
