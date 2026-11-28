import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApi } from "./start-trading-history-api.js"

test("serves all CG-conservative domain scenarios through the local Dashboard catalogue without enabling fake execution", async () => {
  const eventBus = new EventBus()
  let serverInput
  const service = await startTradingHistoryApi({
    eventBus,
    env: {
      TRADING_MODE: "testnet",
    },
    platform: "linux",
    logger: {
      info() {},
    },
    startServer: async (input) => {
      serverInput = input
      return {
        address: {
          address: "127.0.0.1",
          port: 4201,
        },
        close: async () => {},
      }
    },
  })

  try {
    const conservativeRegistration = serverInput.scenarioRunnerCatalog.find((strategy) =>
      strategy.strategyId === "CG-conservative")
    assert.ok(conservativeRegistration,
      "The Harvester API must publish CG-conservative beside Recovery Seller for the Dashboard strategy selector.")
    assert.equal(conservativeRegistration.scenarios.length, 18,
      "The local Dashboard catalogue must expose all eighteen Conservative domain scenarios.")
    assert.ok(serverInput.scenarioRunnerCatalog.some((strategy) => strategy.strategyId === "RS"),
      "Adding Conservative must preserve the existing Recovery Seller registration.")

    for (const scenario of conservativeRegistration.scenarios) {
      assert.equal(scenario.executable, false,
        `CG-conservative scenario ${scenario.id} must not run until its isolated production-flow adapter is registered.`)
      assert.equal(scenario.executionStatus, "BLOCKED",
        `CG-conservative scenario ${scenario.id} must distinguish domain test coverage from runner execution readiness.`)
      assert.ok(scenario.details?.inputEvents,
        `CG-conservative scenario ${scenario.id} must expose its declared event sequence to the Dashboard inspector.`)
    }

    const blockedRun = serverInput.scenarioRunner.submit({
      strategyId: "CG-conservative",
      scenarioId: conservativeRegistration.scenarios[0].id,
      input: {},
    })
    assert.equal(blockedRun.status, "Blocked",
      "The local API must refuse CG execution instead of routing a domain coverage record through the Recovery Seller worker.")
  } finally {
    await service.close()
    await eventBus.close()
  }
})
