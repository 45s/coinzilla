function isDigit({ character }) {
  return character >= "0" && character <= "9"
}

function readJsonNumber({ text, index }) {
  const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
  return match?.[0]
}

function isDepthNumberStart({ character, text, index }) {
  if (character !== "-" && !isDigit({ character })) {
    return false
  }
  let previous = index - 1
  while (previous >= 0 && /\s/.test(text[previous])) {
    previous -= 1
  }
  return text[previous] === "[" || text[previous] === ","
}

function quoteDepthArray({ text, startIndex }) {
  let index = startIndex
  let depth = 1
  let inString = false
  let escaped = false
  let output = ""
  while (index < text.length && depth > 0) {
    const character = text[index]
    if (inString) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      index += 1
      continue
    }
    if (character === '"') {
      inString = true
      output += character
      index += 1
      continue
    }
    if (character === "[") {
      depth += 1
      output += character
      index += 1
      continue
    }
    if (character === "]") {
      depth -= 1
      output += character
      index += 1
      continue
    }
    if (depth === 2 && isDepthNumberStart({
      character,
      text,
      index,
    })) {
      const number = readJsonNumber({
        text,
        index,
      })
      if (number !== undefined) {
        output += JSON.stringify(number)
        index += number.length
        continue
      }
    }
    output += character
    index += 1
  }
  return {
    output,
    index,
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
