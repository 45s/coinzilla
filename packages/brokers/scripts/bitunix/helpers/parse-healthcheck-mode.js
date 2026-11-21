const MODE_BY_ARGUMENT = Object.freeze({
  "--help": "help",
  "--local": "local",
  "--publish": "publish",
  "--place-order": "place-order",
})

/**
 * Parse the single supported Bitunix health-check mode.
 *
 * @param {{args?: string[]}} input
 * @returns {"help"|"local"|"publish"|"place-order"}
 */
export function parseBitunixHealthcheckMode({ args = [] } = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Bitunix health-check arguments must be an array of strings")
  }
  if (args.length === 0) {
    return "publish"
  }
  if (args.length !== 1 || !Object.hasOwn(MODE_BY_ARGUMENT, args[0])) {
    throw new Error("Use only one Bitunix health-check mode: --help, --local, --publish, or --place-order")
  }
  return MODE_BY_ARGUMENT[args[0]]
}
