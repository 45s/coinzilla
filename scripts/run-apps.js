import { spawn } from 'node:child_process'

const commands = {
  server: ['--filter', '@coinzilla/harvester', 'dev'],
  client: ['--filter', '@coinzilla/dashboard', 'start'],
}

const requested = process.argv[2]
const selected = requested === 'app' ? Object.keys(commands) : [requested]

if (!selected.every((name) => Object.hasOwn(commands, name))) {
  console.error('Usage: pnpm run server | client | app')
  process.exit(1)
}

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = new Map()
let stopping = false

function stopChildren(exitCode = 0) {
  if (stopping) return
  stopping = true

  for (const child of children.values()) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }

  process.exitCode = exitCode
}

for (const name of selected) {
  const child = spawn(packageManager, commands[name], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  children.set(name, child)
  child.on('error', (error) => {
    console.error(`Unable to start ${name}: ${error.message}`)
    stopChildren(1)
  })
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (!stopping) {
      const exitCode = code ?? (signal ? 1 : 0)
      if (exitCode !== 0 || selected.length > 1) stopChildren(exitCode)
    }
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChildren(signal === 'SIGINT' ? 130 : 143))
}
