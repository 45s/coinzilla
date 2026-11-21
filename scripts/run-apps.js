import { spawn } from 'node:child_process'

const commands = {
  server: ['--filter', '@coinzilla/harvester', 'dev'],
  client: ['--filter', '@coinzilla/dashboard', 'start'],
  'server:prod': ['--filter', '@coinzilla/harvester', 'start'],
  'client:prod': ['--filter', '@coinzilla/dashboard', 'build'],
}

const [, , requested] = process.argv
let selected

if (requested === 'app') {
  selected = ['server', 'client']
} else if (requested === 'app:prod') {
  selected = ['server:prod', 'client:prod']
} else {
  selected = [requested]
}

if (!selected.every((name) => Object.hasOwn(commands, name))) {
  process.stderr.write('Usage: pnpm run server | client | app | app:prod\n')
  process.exit(1)
}

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = new Map()
let stopping = false

function stopChildren(exitCode = 0) {
  if (stopping) {
    return
  }
  stopping = true

  for (const child of children.values()) {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM')
    }
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
    process.stderr.write(`Unable to start ${name}: ${error.message}\n`)
    stopChildren(1)
  })
  child.on('exit', (...exitArguments) => {
    const [code, signal] = exitArguments
    children.delete(name)
    if (!stopping) {
      const exitCode = code ?? (signal ? 1 : 0)
      if (exitCode !== 0 || (selected.length > 1 && name !== 'client:prod')) {
        stopChildren(exitCode)
      }
    }
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChildren(signal === 'SIGINT' ? 130 : 143))
}
