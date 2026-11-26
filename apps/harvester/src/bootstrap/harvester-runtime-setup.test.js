import nodeTest from "node:test"
import assert from "node:assert/strict"
import { resumeHarvesterDeferredStrategyEvaluations } from "./harvester-runtime-setup.js"

const test = (...args) => nodeTest(`[harvester-runtime-setup.test.js] ${args[0]}`, ...args.slice(1))

test("returns and awaits the deferred engine evaluation result", async () => {
  let releaseReplay
  let replayStarted = false
  const replay = new Promise((resolve) => { releaseReplay = resolve })
  const resultPromise = resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: {
      resumeDeferredEvaluations: async () => {
        replayStarted = true
        await replay
        return { ok: true, data: { resumed: 1 } }
      },
    },
    userDataState: {
      ready: true,
      stopped: false,
      shutdownRequested: false,
    },
    logger: {},
  })

  await Promise.resolve()
  assert.equal(replayStarted, true, "The engine replay must start when the user-data gate is ready.")
  assert.equal(typeof resultPromise?.then, "function", "Bootstrap must receive a promise it can await.")
  releaseReplay()
  const result = await resultPromise
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { resumed: 1 })
})
