const START_MARKER = "// BEGIN GENERATED PAIR CONFIGURATION"
const END_MARKER = "// END GENERATED PAIR CONFIGURATION"

/**
 * Replace only the explicitly marked pair entries in the application config module.
 *
 * The generator intentionally does not parse and re-serialize the whole ESM
 * module: imports, expressions, comments, and operator-maintained formatting
 * outside this generated region must remain untouched.
 *
 * @param {{source: string, pairs: object}} options - Original module source and validated pair map.
 * @returns {string} Updated JavaScript module source.
 * @throws {TypeError} If the source or pair map is invalid or the marker region is ambiguous.
 */
export function replacePairConfiguration({ source, pairs } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a JavaScript module string")
  }
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs) || Object.keys(pairs).length === 0) {
    throw new TypeError("pairs must be a non-empty pair map")
  }

  const startCount = source.split(START_MARKER).length - 1
  const endCount = source.split(END_MARKER).length - 1
  if (startCount !== 1 || endCount !== 1) {
    throw new TypeError("App config module must contain exactly one generated pair-region marker pair")
  }

  const startIndex = source.indexOf(START_MARKER)
  const contentStart = startIndex + START_MARKER.length
  const endIndex = source.indexOf(END_MARKER)
  if (endIndex < contentStart) {
    throw new TypeError("App config module generated pair-region markers are out of order")
  }

  const serializedPairs = JSON.stringify(pairs, null, 2)
  const generatedLines = serializedPairs
    .split("\n")
    .slice(1, -1)
    .map((line) => "      " + line)
  const generatedContent = "\n" + generatedLines.join("\n") + "\n        "

  return source.slice(0, contentStart)
    + generatedContent
    + source.slice(endIndex)
}
