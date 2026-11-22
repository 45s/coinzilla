const MODE_BY_ARGUMENT = Object.freeze({
  "--help": "help",
  "--version": "version",
  "--local": "local",
  "--publish": "publish",
  "--place-order": "place-order",
})

/**
 * Parse one supported Bitunix health-check or order-probe mode.
 *
 * @param {{args?: string[]}} input
 * @returns {"help"|"version"|"local"|"publish"|"place-order"|"probe-order"}
 */
export function parseHealthcheckMode({ args = [] } = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Bitunix health-check arguments must be an array of strings")
  }
  if (args.length === 0) {
    return "publish"
  }
  if (args.length === 1 && args[0].startsWith("--probe-order=") &&
      args[0].slice("--probe-order=".length).trim()) {
    return "probe-order"
  }
  if (args.length !== 1 || !Object.hasOwn(MODE_BY_ARGUMENT, args[0])) {
    throw new Error("Use one Bitunix mode: --help, --version, --local, --publish, --place-order, or --probe-order=<probe-id>")
  }
  return MODE_BY_ARGUMENT[args[0]]
}
