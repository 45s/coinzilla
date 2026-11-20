import { spawnSync } from "node:child_process"
import { emitKeypressEvents } from "node:readline"
import { createInterface as createPromptInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { pathToFileURL } from "node:url"

import {
  buildTestnetMenuArguments,
  PROMPT_DEFAULTS,
  TESTNET_MENU_ACTIONS,
  normalizePromptAnswer,
  resolveTestnetMenuKeypress,
} from "./testnet-menu-inputs.js"

const prompt = async (question) => {
  const readline = createPromptInterface({
    input: stdin,
    output: stdout,
  })
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
      ? {
        symbol: "DOGEUSDT",
        limit: "1000",
      }[key] ?? value
      : value
    const answer = await prompt(`${label}${actionDefault ? ` [${actionDefault}]` : ""}: `)
    answers[key] = normalizePromptAnswer({
      answer,
      fallback: actionDefault,
    })
  }
  return buildTestnetMenuArguments({
    actionId: action.id,
    answers,
  })
}

const renderMenu = (selectedIndex) => {
  stdout.write("\x1b[2J\x1b[H")
  stdout.write("╔══════════════════════════════════════════════════════╗\n")
  stdout.write("║              HARVESTER TESTNET TOOLS                 ║\n")
  stdout.write("╠══════════════════════════════════════════════════════╣\n")
  for (const [index, action] of TESTNET_MENU_ACTIONS.entries()) {
    const marker = index === selectedIndex ? ">" : " "
    stdout.write(`║ ${marker} ${action.label.padEnd(52)} ║\n`)
  }
  stdout.write("╠══════════════════════════════════════════════════════╣\n")
  stdout.write("║  ↑/↓ Navigate   Enter Select   Q/Esc Exit             ║\n")
  stdout.write("╚══════════════════════════════════════════════════════╝\n")
}

const waitForKeypress = () => new Promise((resolve) => {
  stdin.once("keypress", (...keypressArguments) => resolve({
    character: keypressArguments[0],
    key: keypressArguments[1],
  }))
})

const waitForMenuNavigation = async ({ selectedIndex }) => {
  renderMenu(selectedIndex)
  const { character, key = {} } = await waitForKeypress()

  return resolveTestnetMenuKeypress({
    character,
    key,
    selectedIndex,
    actionCount: TESTNET_MENU_ACTIONS.length,
  })
}

const stderrWrite = (message) => process.stderr.write(message)

const runAction = async (action) => {
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

const runSelectedMenuAction = async ({ action, hideMenu, showMenu }) => {
  stdin.setRawMode(false)
  hideMenu()
  await runAction(action)
  stdin.setRawMode(true)
  showMenu()
}

const runMenuLoop = async ({ hideMenu, showMenu }) => {
  let selectedIndex = 0

  while (true) {
    const navigation = await waitForMenuNavigation({ selectedIndex })
    const {
      type,
      selectedIndex: nextSelectedIndex,
    } = navigation
    selectedIndex = nextSelectedIndex

    if (type === "EXIT") {return}
    if (type !== "SELECT") {continue}

    const action = TESTNET_MENU_ACTIONS[selectedIndex]
    if (action.id === "exit") {return}

    await runSelectedMenuAction({
      action,
      hideMenu,
      showMenu,
    })
  }
}

export const runTestnetMenu = async () => {
  if (typeof stdin.setRawMode !== "function" || !stdin.isTTY) {
    throw new Error("The TESTNET menu requires an interactive terminal.")
  }

  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()

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
    await runMenuLoop({
      hideMenu,
      showMenu,
    })
  } finally {
    stdin.setRawMode(false)
    if (menuVisible) {hideMenu()}
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
