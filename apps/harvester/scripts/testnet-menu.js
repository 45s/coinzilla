import { spawnSync } from "node:child_process"
import { createInterface, emitKeypressEvents } from "node:readline"
import { createInterface as createPromptInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { pathToFileURL } from "node:url"

import {
  buildTestnetMenuArguments,
  PROMPT_DEFAULTS,
  TESTNET_MENU_ACTIONS,
  normalizePromptAnswer,
} from "./testnet-menu-utils.js"

const prompt = async (question) => {
  const readline = createPromptInterface({ input: stdin, output: stdout })
  try {
    return await readline.question(question)
  } finally {
    readline.close()
  }
}

const collectArguments = async (action) => {
  const answers = {}
  for (const key of action.prompts ?? []) {
    const { label, value } = PROMPT_DEFAULTS[key]
    const actionDefault = action.id === "trades"
      ? { symbol: "DOGEUSDT", limit: "1000" }[key] ?? value
      : value
    const answer = await prompt(`${label}${actionDefault ? ` [${actionDefault}]` : ""}: `)
    answers[key] = normalizePromptAnswer(answer, actionDefault)
  }
  return buildTestnetMenuArguments({ actionId: action.id, answers })
}

const renderMenu = (selectedIndex) => {
  stdout.write("\x1b[2J\x1b[H")
  stdout.write("╔══════════════════════════════════════════════════════╗\n")
  stdout.write("║              HARVESTER TESTNET TOOLS                 ║\n")
  stdout.write("╠══════════════════════════════════════════════════════╣\n")
  for (const [index, action] of TESTNET_MENU_ACTIONS.entries()) {
    const marker = index === selectedIndex ? ">" : " "
    const warning = action.destructive ? "  [CONFIRM]" : ""
    stdout.write(`║ ${marker} ${action.label.padEnd(36)}${warning.padEnd(15)} ║\n`)
  }
  stdout.write("╠══════════════════════════════════════════════════════╣\n")
  stdout.write("║  ↑/↓ Navigate   Enter Select   Q/Esc Exit             ║\n")
  stdout.write("╚══════════════════════════════════════════════════════╝\n")
}

const waitForKeypress = () => new Promise((resolve) => {
  stdin.once("keypress", (character, key) => resolve({ character, key }))
})

const runAction = async (action) => {
  if (action.destructive && action.id === "cancel-orders") {
    stdout.write("\nWARNING: this cancels every open TESTNET order on every symbol.\n")
    stdout.write("Stop Harvester and any other trading process before continuing.\n")
    const confirmation = await prompt('Type "CANCEL ALL OPEN TESTNET ORDERS" to continue: ')
    if (normalizePromptAnswer(confirmation) !== "CANCEL ALL OPEN TESTNET ORDERS") {
      stdout.write("\nConfirmation did not match. No orders were cancelled.\n")
      await prompt("Press Enter to return to the menu...")
      return
    }
  }

  const args = await collectArguments(action)
  stdout.write(`\nExecuting: ${action.script}${args.length ? ` ${args.join(" ")}` : ""}\n\n`)

  const result = spawnSync(
    process.execPath,
    ["--env-file=.env.development", `scripts/${action.script}`, ...args],
    { stdio: "inherit" },
  )

  if (result.error) {
    stderrWrite(`Unable to start script: ${result.error.message}\n`)
  } else if (result.status !== 0) {
    stderrWrite(`\nScript exited with status ${result.status ?? "unknown"}.\n`)
  }

  await prompt("\nPress Enter to return to the menu...")
}

const stderrWrite = (message) => process.stderr.write(message)

export const runTestnetMenu = async () => {
  if (typeof stdin.setRawMode !== "function" || !stdin.isTTY) {
    throw new Error("The TESTNET menu requires an interactive terminal.")
  }

  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()

  let selectedIndex = 0
  let menuVisible = false
  const showMenu = () => {
    stdout.write("\x1b[?1049h\x1b[?25l")
    menuVisible = true
  }
  const hideMenu = () => {
    stdout.write("\x1b[?25h\x1b[?1049l")
    menuVisible = false
  }

  try {
    showMenu()
    while (true) {
      renderMenu(selectedIndex)
      const { character, key = {} } = await waitForKeypress()

      if (key.ctrl && key.name === "c") return
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + TESTNET_MENU_ACTIONS.length) % TESTNET_MENU_ACTIONS.length
        continue
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % TESTNET_MENU_ACTIONS.length
        continue
      }
      if (key.name === "escape" || character?.toLowerCase() === "q") return
      if (key.name !== "return" && key.name !== "enter") continue

      const action = TESTNET_MENU_ACTIONS[selectedIndex]
      if (action.id === "exit") return

      stdin.setRawMode(false)
      hideMenu()
      await runAction(action)
      stdin.setRawMode(true)
      showMenu()
    }
  } finally {
    stdin.setRawMode(false)
    if (menuVisible) hideMenu()
    stdout.write("\n")
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  runTestnetMenu().catch((error) => {
    stderrWrite(`\nUnable to open TESTNET menu: ${error.message}\n`)
    process.exitCode = 1
  })
}
