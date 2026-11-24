const JSON_NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g
const DEPTH_LEVEL_PATTERN = /\[(?:\s*-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\s*,?)+\s*\]/g

function findArrayEnd({ text, startIndex }) {
  let index = startIndex
  let depth = 1
  let inString = false
  let escaped = false
  while (index < text.length && depth > 0) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
    } else if (character === '"') {
      inString = true
    } else if (character === "[") {
      depth += 1
    } else if (character === "]") {
      depth -= 1
    }
    index += 1
  }
  return index
}

function quoteNumericLevelArrays({ arrayText }) {
  return arrayText.replace(DEPTH_LEVEL_PATTERN, (level) => (
    level.replace(JSON_NUMBER_PATTERN, (number) => JSON.stringify(number))
  ))
}

function quoteDepthArray({ text, startIndex }) {
  const endIndex = findArrayEnd({
    text,
    startIndex,
  })
  const arrayText = text.slice(startIndex - 1, endIndex)
  return {
    output: quoteNumericLevelArrays({
      arrayText,
    }).slice(1),
    index: endIndex,
  }
}

/**
 * Quote numeric tokens inside Bitunix depth asks/bids arrays before JSON.parse.
 * This prevents binary floating-point rounding of exchange price/quantity data.
 *
 * @param {{text: string}} input
 * @returns {string}
 */
export function quoteDepthLevelNumbers({ text } = {}) {
  if (typeof text !== "string") {
    throw new TypeError("Bitunix Futures depth response text must be a string")
  }
  const propertyPattern = /"(?:asks|bids)"\s*:\s*\[/g
  let cursor = 0
  let output = ""
  let match = propertyPattern.exec(text)
  while (match !== null) {
    const arrayStart = propertyPattern.lastIndex
    output += text.slice(cursor, arrayStart)
    const quotedArray = quoteDepthArray({
      text,
      startIndex: arrayStart,
    })
    output += quotedArray.output
    cursor = quotedArray.index
    propertyPattern.lastIndex = cursor
    match = propertyPattern.exec(text)
  }
  return output + text.slice(cursor)
}
