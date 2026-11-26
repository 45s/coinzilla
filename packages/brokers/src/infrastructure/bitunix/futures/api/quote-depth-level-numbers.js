function isWhitespace({ character }) {
  return character === " " || character === "\t" || character === "\n" || character === "\r"
}

function skipWhitespace({ text, startIndex }) {
  let index = startIndex
  while (index < text.length && isWhitespace({ character: text[index] })) {
    index += 1
  }
  return index
}

function findStringEnd({ text, startIndex }) {
  let index = startIndex + 1
  let escaped = false
  while (index < text.length) {
    const character = text[index]
    if (escaped) {
      escaped = false
    } else if (character === "\\") {
      escaped = true
    } else if (character === '"') {
      return index + 1
    }
    index += 1
  }
  return text.length
}

function isDigit({ character }) {
  return character >= "0" && character <= "9"
}

function isNumberBoundary({ character }) {
  return character === undefined || character === "," || character === "]" ||
    character === "}" || isWhitespace({ character })
}

function readJsonNumberEnd({ text, startIndex }) {
  let index = startIndex
  if (text[index] === "-") {
    index += 1
  }
  if (text[index] === "0") {
    index += 1
  } else if (text[index] >= "1" && text[index] <= "9") {
    index += 1
    while (isDigit({ character: text[index] })) {
      index += 1
    }
  } else {
    return startIndex
  }
  if (text[index] === ".") {
    index += 1
    if (!isDigit({ character: text[index] })) {
      return startIndex
    }
    while (isDigit({ character: text[index] })) {
      index += 1
    }
  }
  if (text[index] === "e" || text[index] === "E") {
    index += 1
    if (text[index] === "+" || text[index] === "-") {
      index += 1
    }
    if (!isDigit({ character: text[index] })) {
      return startIndex
    }
    while (isDigit({ character: text[index] })) {
      index += 1
    }
  }
  return isNumberBoundary({ character: text[index] }) ? index : startIndex
}

function quoteArrayNumbers({ text, startIndex }) {
  let index = startIndex
  let depth = 0
  let cursor = startIndex
  let output = ""
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      index = findStringEnd({
        text,
        startIndex: index,
      })
      continue
    }
    if (character === "[") {
      depth += 1
      index += 1
      continue
    }
    if (character === "]") {
      depth -= 1
      index += 1
      if (depth === 0) {
        return {
          output: output + text.slice(cursor, index),
          index,
        }
      }
      continue
    }
    if (depth >= 2 && (character === "-" || isDigit({ character }))) {
      const numberEnd = readJsonNumberEnd({
        text,
        startIndex: index,
      })
      if (numberEnd > index) {
        output += text.slice(cursor, index) + JSON.stringify(text.slice(index, numberEnd))
        cursor = numberEnd
        index = numberEnd
        continue
      }
    }
    index += 1
  }
  return {
    output: output + text.slice(cursor),
    index: text.length,
  }
}

/**
 * Quote numeric tokens inside Bitunix depth asks/bids arrays before JSON.parse.
 * This preserves the exchange's exact decimal text without binary floating-point conversion.
 *
 * @param {{text: string}} input
 * @returns {string}
 */
export function quoteDepthLevelNumbers({ text } = {}) {
  if (typeof text !== "string") {
    throw new TypeError("Bitunix Futures depth response text must be a string")
  }
  let index = 0
  let cursor = 0
  let output = ""
  while (index < text.length) {
    if (text[index] !== '"') {
      index += 1
      continue
    }
    const keyEnd = findStringEnd({
      text,
      startIndex: index,
    })
    const key = text.slice(index, keyEnd)
    if (key !== '"asks"' && key !== '"bids"') {
      index = keyEnd
      continue
    }
    const colonIndex = skipWhitespace({
      text,
      startIndex: keyEnd,
    })
    if (text[colonIndex] !== ":") {
      index = keyEnd
      continue
    }
    const valueIndex = skipWhitespace({
      text,
      startIndex: colonIndex + 1,
    })
    if (text[valueIndex] !== "[") {
      index = keyEnd
      continue
    }
    const quoted = quoteArrayNumbers({
      text,
      startIndex: valueIndex,
    })
    output += text.slice(cursor, valueIndex) + quoted.output
    cursor = quoted.index
    index = quoted.index
  }
  return output + text.slice(cursor)
}
