import readline from "node:readline"

/**
 * Register the interactive /log command without taking ownership of
 * non-interactive stdin (pipes, redirected input, and CI).
 *
 * @param {{ logger: object, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} input
 * @returns {{ enabled: boolean, close: () => void }}
 */
export function createLogCommandInterface({
  logger,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input?.isTTY || typeof logger?.setLevel !== "function") {
    return Object.freeze({ enabled: false, close() {} })
  }

  const commandInterface = readline.createInterface({
    input,
    output,
    terminal: true,
  })

  commandInterface.on("line", (line) => {
    const [command, action, extra] = line.trim().split(/\s+/)

    if (command !== "/log") return

    if (extra || !action || !["info", "debug", "trace", "status"].includes(action)) {
      output.write("Usage: /log info|debug|trace|status\n")
      return
    }

    if (action === "status") {
      output.write(JSON.stringify(logger.getConfig(), null, 2) + "\n")
      return
    }

    try {
      const config = logger.setLevel({ transport: "console", level: action })
      output.write("Console log level: " + action + "\n")
      if (!config) output.write(JSON.stringify(logger.getConfig()) + "\n")
    } catch (error) {
      output.write("Unable to change console log level: " + error.message + "\n")
    }
  })

  return Object.freeze({
    enabled: true,
    close() {
      commandInterface.close()
    },
  })
}
