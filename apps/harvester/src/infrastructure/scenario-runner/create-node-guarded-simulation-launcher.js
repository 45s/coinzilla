import { fork } from "node:child_process"

const TRUSTED_LAUNCHERS = new WeakSet()

export function createNodeGuardedSimulationLauncher() {
  const launcher = ({ workerPath, env, execArgv, stdio }) => fork(workerPath, [], {
    env,
    execArgv,
    stdio,
  })
  TRUSTED_LAUNCHERS.add(launcher)
  return launcher
}

export function isNodeGuardedSimulationLauncher({ launcher } = {}) {
  return typeof launcher === "function" && TRUSTED_LAUNCHERS.has(launcher)
}
