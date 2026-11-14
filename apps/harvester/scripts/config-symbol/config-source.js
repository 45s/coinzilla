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
      throw new TypeError("CG coin-grabber strategy config contains an unterminated string")
    }
    index += 1
  }
  throw new TypeError("CG coin-grabber strategy config contains an unterminated string")
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
      throw new TypeError("CG coin-grabber strategy config contains an unterminated block comment")
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

function findPairsObject(source) {
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
      if (source.slice(identifierStart, index) !== "pairs") {
        continue
      }
      const colonIndex = skipTrivia(source, index)
      if (source[colonIndex] !== ":") {
        continue
      }
      const objectStartIndex = skipTrivia(source, colonIndex + 1)
      if (source[objectStartIndex] === "{") {
        matches.push({ propertyIndex: identifierStart, objectStartIndex })
      }
      continue
    }
    index += 1
  }

  if (matches.length === 0) {
    throw new TypeError("CG coin-grabber strategy module must contain a pairs object")
  }
  if (matches.length !== 1) {
    throw new TypeError("CG coin-grabber strategy module contains an ambiguous pairs object; exactly one is required")
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
  throw new TypeError("CG coin-grabber strategy pairs object is not closed")
}

/**
 * Insert one validated pair into the existing CG coin-grabber pairs object.
 *
 * Only the new property is serialized. Existing pair expressions, comments,
 * imports, settings, and source formatting outside the insertion point remain intact.
 *
 * @param {{source: string, symbol: string, pairConfig: object}} options - Original strategy module and new pair.
 * @returns {string} Updated JavaScript module source.
 * @throws {TypeError} If the source, symbol, pair, or insertion target is invalid or ambiguous.
 */
export function insertPairConfiguration({ source, symbol, pairConfig } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a JavaScript module string")
  }
  if (typeof symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("symbol must contain 5–20 uppercase ASCII letters or digits")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig) || Object.keys(pairConfig).length === 0) {
    throw new TypeError("pair config must be a non-empty object")
  }

  const { propertyIndex, objectStartIndex } = findPairsObject(source)
  const objectEndIndex = findMatchingObjectEnd(source, objectStartIndex)
  const lineStartIndex = source.lastIndexOf("\n", propertyIndex - 1) + 1
  const propertyPrefix = source.slice(lineStartIndex, propertyIndex)
  if (!/^[\t ]*$/.test(propertyPrefix)) {
    throw new TypeError("CG coin-grabber pairs property must start on its own line")
  }
  const pairIndent = propertyPrefix + "  "

  let serializedPair
  try {
    serializedPair = JSON.stringify({ [symbol]: pairConfig }, null, 2)
  } catch (cause) {
    throw new TypeError("pair config must be JSON-serializable", { cause })
  }
  if (typeof serializedPair !== "string") {
    throw new TypeError("pair config must be JSON-serializable")
  }

  const generatedLines = serializedPair
    .split("\n")
    .slice(1, -1)
    .map((line) => pairIndent + line.slice(2))
  generatedLines[generatedLines.length - 1] += ","

  const originalContentStartsWithLineBreak = source[objectStartIndex + 1] === "\n"
    || source[objectStartIndex + 1] === "\r"
  const insertion = "\n" + generatedLines.join("\n")
    + (originalContentStartsWithLineBreak ? "" : "\n" + propertyPrefix)

  return source.slice(0, objectStartIndex + 1)
    + insertion
    + source.slice(objectStartIndex + 1, objectEndIndex + 1)
    + source.slice(objectEndIndex + 1)
}
