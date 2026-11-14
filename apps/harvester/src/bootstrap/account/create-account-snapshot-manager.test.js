import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { createAccountSnapshotManager } from "./create-account-snapshot-manager.js"

const test = (name, ...args) => nodeTest("[create-account-snapshot-manager.test.js] " + name, ...args)

const createFixture = ({
  accountSnapshots = [],
  accountSnapshotError,
  openOrders = [],
  openOrdersResult,
  openOrdersError,
  flushResults = [],
  portfolio = new Portfolio(),
  activeOrders = [],
  operationalStateStore,
  logger = {},
  monotonicNow
} = {}) => {
  const baseAsset = new Asset({
    id: "asset:BTC",
    code: "BTC"
  })
  const quoteAsset = new Asset({
    id: "asset:USDT",
    code: "USDT"
  })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset
  })
  let snapshotIndex = 0
  const publishedEvents = []
  let flushCount = 0
  const manager = createAccountSnapshotManager({
    broker: {
      getAccountSnapshot: async () => {
        if (accountSnapshotError) { throw accountSnapshotError }
        return accountSnapshots[Math.min(snapshotIndex++, accountSnapshots.length - 1)]
      },
      getOpenOrders: async () => {
        if (openOrdersError) { throw openOrdersError }
        return openOrdersResult ?? ({
          ok: true,
          data: openOrders
        })
      },
    },
    eventPublisher: {
      publish: (event) => {
        publishedEvents.push(event)
        return { ok: true }
      },
      flush: async () => {
        flushCount += 1
        return flushResults[flushCount - 1] ?? {
          ok: true,
          durable: true
        }
      },
    },
    marketMetadata: new Map([[market.symbol, { market }]]),
    getPortfolio: () => portfolio,
    getTradingEngine: () => ({ getActiveOrders: () => activeOrders }),
    getRecoveredState: () => ({ orderRegistry: { orders: [] } }),
    getHasCanonicalOwnershipReconciliation: () => false,
    logger,
    now: () => 123,
    monotonicNow,
    operationalStateStore,
  })
  return {
    manager,
    market,
    baseAsset,
    quoteAsset,
    publishedEvents,
    getFlushCount: () => flushCount,
  }
}

const createAccountSnapshot = ({
  market,
  sourceTime,
  extraBalances = []
}) => ({
  ok: true,
  data: {
    sourceTime,
    balances: [
      new Balance({
        free: new Quantity({
          amount: "1.25",
          asset: market.baseAsset
        }),
        locked: new Quantity({
          amount: "0.25",
          asset: market.baseAsset
        }),
      }),
      new Balance({
        free: new Quantity({
          amount: "500",
          asset: market.quoteAsset
        }),
        locked: new Quantity({
          amount: "0",
          asset: market.quoteAsset
        }),
      }),
      ...extraBalances,
    ],
  },
})

test("captures configured-asset balances and durably publishes the account audit", async () => {
  const market = createFixture().market
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
  })

  const snapshot = await fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })

  assert.equal(snapshot.sourceTime, 100, "The account snapshot must preserve the broker's source timestamp.")
  assert.equal(fixture.manager.getAccountSnapshot().sourceTime, 100, "The accepted snapshot must become the manager's current account view.")
  assert.equal(fixture.publishedEvents.length, 1, "The PREFLIGHT balance audit must publish exactly one lifecycle event.")
  assert.equal(fixture.publishedEvents[0].data.phase, "PREFLIGHT", "The account audit event must retain its requested lifecycle phase.")
  assert.equal(fixture.publishedEvents[0].data.balances.length, 2, "The audit must include both configured market assets.")
  assert.equal(fixture.getFlushCount(), 1, "The account audit must be durably flushed before the call resolves.")
})

test("publishes only the actual third-asset commission baseline and excludes unrelated wallet assets", async () => {
  const market = createFixture().market
  const bnb = new Asset({
    id: "asset:BNB",
    code: "BNB"
  })
  const xrp = new Asset({
    id: "asset:XRP",
    code: "XRP"
  })
  const fixture = createFixture({
    accountSnapshots: [
      createAccountSnapshot({
        market,
        sourceTime: 100,
        extraBalances: [
          new Balance({
            free: new Quantity({
              amount: "1",
              asset: bnb
            }),
            locked: new Quantity({
              amount: "0",
              asset: bnb
            }),
          }),
          new Balance({
            free: new Quantity({
              amount: "25",
              asset: xrp
            }),
            locked: new Quantity({
              amount: "0",
              asset: xrp
            }),
          }),
        ],
      }),
      createAccountSnapshot({
        market,
        sourceTime: 200,
        extraBalances: [
          new Balance({
            free: new Quantity({
              amount: "0.9999",
              asset: bnb
            }),
            locked: new Quantity({
              amount: "0",
              asset: bnb
            }),
          }),
          new Balance({
            free: new Quantity({
              amount: "25",
              asset: xrp
            }),
            locked: new Quantity({
              amount: "0",
              asset: xrp
            }),
          }),
        ],
      }),
    ],
  })

  const snapshot = await fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })

  assert.equal(snapshot.getFreeBalance({ assetId: bnb.id }), undefined)
  assert.equal(fixture.publishedEvents[0].data.balances.some(({ asset }) => asset === "BNB"), false)
  assert.equal(fixture.publishedEvents[0].data.balances.some(({ asset }) => asset === "XRP"), false)

  const baseline = await fixture.manager.publishCommissionAssetBaseline({
    assetId: bnb.id,
    assetCode: bnb.code,
  })

  assert.equal(baseline.ok, true)
  assert.equal(fixture.publishedEvents.length, 2)
  assert.equal(fixture.publishedEvents[1].data.phase, "COMMISSION_BASELINE")
  assert.equal(fixture.publishedEvents[1].data.sourceTime, 100)
  assert.deepEqual(fixture.publishedEvents[1].data.balances, [{
    asset: "BNB",
    free: "1",
    locked: "0",
    total: "1",
  }])
  assert.equal(fixture.publishedEvents.some(({ data }) => data.balances.some(({ asset }) => asset === "XRP")), false)

  const duplicate = await fixture.manager.publishCommissionAssetBaseline({
    assetId: bnb.id,
    assetCode: bnb.code,
  })
  assert.equal(duplicate.data.reason, "BASELINE_ALREADY_CAPTURED")
  assert.equal(fixture.publishedEvents.length, 2)
  assert.equal(fixture.getFlushCount(), 2)

  const refreshed = await fixture.manager.refreshAccountSnapshot()
  assert.equal(refreshed.getFreeBalance({ assetId: bnb.id }).amount, "0.9999")
  assert.equal(refreshed.getFreeBalance({ assetId: xrp.id }), undefined)
})

test("fails closed when an actual commission asset has no PREFLIGHT balance", async () => {
  const market = createFixture().market
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
  })
  await fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })

  await assert.rejects(
    fixture.manager.publishCommissionAssetBaseline({
      assetId: "asset:BNB",
      assetCode: "BNB",
    }),
    /PREFLIGHT account snapshot is missing commission asset BNB/,
  )
  assert.equal(fixture.publishedEvents.length, 1)
})

test("captures Portfolio and active-order baselines at the account snapshot boundary", async () => {
  const fixtureMarket = createFixture().market
  const portfolioFill = new Fill({
    tradeId: "snapshot-baseline-buy-fill",
    brokerOrderId: "snapshot-baseline-buy-order",
    market: fixtureMarket,
    side: "BUY",
    price: new Money({
      amount: "10",
      asset: fixtureMarket.quoteAsset
    }),
    quantity: new Quantity({
      amount: "10",
      asset: fixtureMarket.baseAsset
    }),
    quoteQuantity: new Money({
      amount: "100",
      asset: fixtureMarket.quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const portfolio = new Portfolio().applyFill({ fill: portfolioFill }).portfolio
  const activeBuyOrder = new CanonicalOrder({
    clientOrderId: "snapshot-baseline-active-buy",
    brokerOrderId: "snapshot-baseline-active-buy-broker",
    market: fixtureMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "50",
      asset: fixtureMarket.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "3",
      asset: fixtureMarket.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: fixtureMarket.baseAsset
    }),
    status: "PARTIALLY_FILLED",
  })
  const activeSellOrder = new CanonicalOrder({
    clientOrderId: "snapshot-baseline-active-sell",
    brokerOrderId: "snapshot-baseline-active-sell-broker",
    market: fixtureMarket,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "11",
      asset: fixtureMarket.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "5",
      asset: fixtureMarket.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "2",
      asset: fixtureMarket.baseAsset
    }),
    status: "PARTIALLY_FILLED",
  })
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market: fixtureMarket,
      sourceTime: 100
    })],
    portfolio,
    activeOrders: [activeBuyOrder, activeSellOrder],
  })

  const snapshot = await fixture.manager.refreshAccountSnapshot()

  assert.equal(snapshot.getQuoteCashFlowBaseline({ assetId: fixtureMarket.quoteAsset.id }), "-100", "The quote cash-flow baseline must reflect the Portfolio BUY already represented by the exchange snapshot.")
  assert.equal(snapshot.getPortfolioBaseQuantityBaseline({ assetId: fixtureMarket.baseAsset.id }), "10", "The total Portfolio base baseline must include active and retained free quantities at snapshot time.")
  assert.equal(snapshot.getCommittedQuoteBalanceBaseline({ assetId: fixtureMarket.quoteAsset.id }), "100", "The BUY commitment baseline must equal the remaining two units multiplied by the exact 50 quote limit price.")
  assert.equal(snapshot.getCommittedBaseBalanceBaseline({ assetId: fixtureMarket.baseAsset.id }), "3", "The SELL commitment baseline must equal the remaining three units of the partially filled SELL order.")
})

test("rejects an account snapshot that omits a configured market asset", async () => {
  const fixture = createFixture({
    accountSnapshots: [{
      ok: true,
      data: {
        sourceTime: 100,
        balances: [
          new Balance({
            free: new Quantity({
              amount: "1",
              asset: new Asset({
              id: "asset:BTC",
              code: "BTC"
            })
            }),
            locked: new Quantity({
              amount: "0",
              asset: new Asset({
              id: "asset:BTC",
              code: "BTC"
            })
            }),
          }),
        ],
      },
    }],
  })

  await assert.rejects(
    fixture.manager.refreshAccountSnapshot(),
    (error) => {
      assert.match(error.message, /missing required market asset balances: USDT/)
      assert.deepEqual(error.recoveryFailure, {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_SNAPSHOT_VALIDATION",
        retryable: false,
      })
      return true
    },
    "A startup snapshot missing the configured quote asset must fail closed as terminal integrity failure.",
  )
  assert.equal(fixture.manager.getAccountSnapshot(), undefined, "An incomplete account snapshot must not become the accepted account view.")
})

test("treats unclassified thrown account snapshot and open-orders adapter errors as terminal", async () => {
  const accountFixture = createFixture({ accountSnapshotError: new Error("unexpected account adapter exception") })
  await assert.rejects(accountFixture.manager.refreshAccountSnapshot(), (error) => {
    assert.deepEqual(error.recoveryFailure, {
      category: "ACCOUNTING_INTEGRITY",
      stage: "ACCOUNT_SNAPSHOT_READ_EXCEPTION",
      retryable: false
    })
    return true
  })
  const ordersFixture = createFixture({ openOrdersError: new Error("unexpected open-orders adapter exception") })
  await assert.rejects(ordersFixture.manager.publishOpenOrdersSnapshot(), (error) => {
    assert.deepEqual(error.recoveryFailure, {
      category: "ACCOUNTING_INTEGRITY",
      stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ_EXCEPTION",
      retryable: false
    })
    return true
  })
})

test("treats account snapshot responses without an explicit success flag as terminal integrity failures", async () => {
  const fixture = createFixture({ accountSnapshots: [{ data: { balances: [] } }] })
  await assert.rejects(fixture.manager.refreshAccountSnapshot(), (error) => {
    assert.deepEqual(error.recoveryFailure, {
      category: "ACCOUNTING_INTEGRITY",
      stage: "ACCOUNT_SNAPSHOT_RESPONSE",
      retryable: false,
    })
    return true
  })
})

test("does not replace a newer accepted account snapshot with stale broker data", async () => {
  const fixture = createFixture({
    accountSnapshots: [
      createAccountSnapshot({
        market: createFixture().market,
        sourceTime: 100
      }),
      createAccountSnapshot({
        market: createFixture().market,
        sourceTime: 99
      }),
    ],
  })

  await fixture.manager.refreshAccountSnapshot()
  await assert.rejects(
    fixture.manager.refreshAccountSnapshot(),
    /older than the previously accepted snapshot/,
    "A stale broker snapshot must be rejected rather than replacing newer account state.",
  )
  assert.equal(fixture.manager.getAccountSnapshot().sourceTime, 100, "A stale response must leave the latest accepted account snapshot unchanged.")
})

test("treats an invalid open-orders audit DTO as terminal integrity failure", async () => {
  const fixture = createFixture()

  await assert.rejects(
    fixture.manager.publishOpenOrdersSnapshot({ orders: [{}] }),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD",
        retryable: false,
      }, "A failed DTO mapping must not be mislabeled as a retryable Journal publication failure.")
      return true
    },
  )

  assert.equal(fixture.publishedEvents.length, 0, "An invalid audit DTO must not be published.")
  assert.equal(fixture.getFlushCount(), 0, "An invalid audit DTO must not trigger a durability flush.")
})

test("records unowned open orders as blocked without adopting them", async () => {
  const externalOrder = {
    id: "external-order-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-order-1",
  }
  const fixture = createFixture({ openOrders: [externalOrder] })

  const orders = await fixture.manager.publishOpenOrdersSnapshot()

  assert.equal(orders.length, 1, "The account-wide audit must retain the observed external open order.")
  assert.equal(fixture.publishedEvents[0].data.readiness, "BLOCKED", "An unowned open order must be recorded as blocked in the audit event.")
  assert.deepEqual(fixture.manager.getAccountSnapshot(), undefined, "An open-order audit must not manufacture an account balance snapshot.")
  assert.equal(fixture.getFlushCount(), 1, "The open-order audit must be durably flushed before startup continues.")
})


test("records unowned open orders as blocked and scopes the strategy gate to their symbol", async () => {
  const externalOrder = {
    id: "external-order-1",
    symbol: "DOGEUSDT",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-order-1",
  }
  const openOrders = [externalOrder]
  const fixture = createFixture({ openOrders })

  const orders = await fixture.manager.publishOpenOrdersSnapshot()

  assert.equal(orders.length, 1, "The account-wide audit must retain the observed external open order.")
  assert.equal(fixture.publishedEvents[0].data.readiness, "BLOCKED", "An unowned open order must be recorded as blocked in the audit event.")
  assert.equal(fixture.manager.hasUnownedOpenOrdersForSymbol({ symbol: "DOGEUSDT" }), true)
  assert.equal(fixture.manager.hasUnownedOpenOrdersForSymbol({ symbol: "ZROUSDT" }), false)
  assert.deepEqual(fixture.manager.getAccountSnapshot(), undefined)
  assert.equal(fixture.getFlushCount(), 1)

  openOrders.length = 0
  await fixture.manager.publishOpenOrdersSnapshot({
    phase: "RECOVERY",
    ownershipReconciled: true
  })

  assert.equal(fixture.manager.hasUnownedOpenOrdersForSymbol({ symbol: "DOGEUSDT" }), false)
  assert.equal(fixture.getFlushCount(), 2, "The reconnect snapshot must be durable before the symbol guard clears.")
})

test("retries an account snapshot after a REST timeout without publishing a premature audit", async () => {
  const market = createFixture().market
  const timeout = Object.assign(
    new Error("account.status request timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  const fixture = createFixture({
    accountSnapshots: [
      {
        ok: false,
        errors: [timeout]
      },
      createAccountSnapshot({
        market,
        sourceTime: 100
      }),
    ],
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "REST_RECONCILIATION",
        stage: "ACCOUNT_SNAPSHOT_READ",
        retryable: true,
      }, "A broker-declared account snapshot timeout must be explicitly retryable.")
      assert.equal(
        error.message,
        "Unable to load canonical exchange account balances: account.status request timed out",
        "The account snapshot wrapper must retain its existing contextual timeout message.",
      )
      assert.equal(
        error.cause,
        timeout,
        "The account snapshot wrapper must preserve the exact original broker timeout as native Error.cause.",
      )
      assert.equal(
        error.cause?.name,
        "RpcTimeoutError",
        "The native account snapshot error cause must retain the broker's typed timeout name.",
      )
      return true
    },
    "A failed broker account snapshot result must fail the recovery audit with its actionable timeout message and original cause.",
  )

  assert.equal(
    fixture.manager.getAccountSnapshot(),
    undefined,
    "A timed-out account snapshot must not become the accepted account view.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    0,
    "A failed account REST read must not publish a durable recovery audit.",
  )
  assert.equal(
    fixture.getFlushCount(),
    0,
    "A failed account REST read must not flush an audit that contains no authoritative snapshot.",
  )

  const recoveredSnapshot = await fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" })

  assert.equal(
    recoveredSnapshot.sourceTime,
    100,
    "A later successful REST read must be accepted after the transient timeout.",
  )
  assert.equal(
    fixture.manager.getAccountSnapshot().sourceTime,
    100,
    "The successful retry must become the current account snapshot.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    1,
    "Only the successful retry may publish the recovery account audit.",
  )
  assert.equal(
    fixture.publishedEvents[0].data.phase,
    "RECOVERY",
    "The successful retry must retain the recovery audit phase.",
  )
  assert.equal(
    fixture.getFlushCount(),
    1,
    "The successful retry must durably flush exactly one recovery account audit.",
  )
})


test("preserves the original broker error as cause when the account-wide open-orders snapshot fails", async () => {
  const timeout = Object.assign(
    new Error("account-wide open-orders RPC timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  const fixture = createFixture({
    openOrdersResult: {
      ok: false,
      errors: [timeout]
    },
  })

  await assert.rejects(
    fixture.manager.publishOpenOrdersSnapshot(),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "REST_RECONCILIATION",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ",
        retryable: true,
      }, "A broker-declared account-wide open-orders timeout must be explicitly retryable.")
      assert.equal(
        error.message,
        "Unable to load authoritative account-wide open orders: account-wide open-orders RPC timed out",
        "The open-orders snapshot wrapper must retain its existing contextual timeout message.",
      )
      assert.equal(
        error.cause,
        timeout,
        "The open-orders snapshot wrapper must preserve the exact original broker timeout as native Error.cause.",
      )
      assert.equal(
        error.cause?.name,
        "RpcTimeoutError",
        "The native open-orders snapshot cause must retain the broker's typed timeout name.",
      )
      return true
    },
    "A failed account-wide open-orders REST read must fail the audit with its original broker Error as cause.",
  )

  assert.equal(
    fixture.publishedEvents.length,
    0,
    "A failed account-wide open-orders REST read must not publish an audit event without authoritative data.",
  )
  assert.equal(
    fixture.getFlushCount(),
    0,
    "A failed account-wide open-orders REST read must not flush an audit event that was never published.",
  )
})


test("classifies a permanent Journal write failure as terminal during the recovery account audit", async () => {
  const market = createFixture().market
  const writeError = new Error("Journal session is failed after a previous write error")
  const recoveryFailure = {
    category: "DURABILITY",
    stage: "JOURNAL_WRITE_FAILURE",
    retryable: false,
  }
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
    flushResults: [{
      ok: false,
      durable: false,
      errors: [writeError],
      recoveryFailure,
    }],
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.match(error.message, /Unable to durably persist RECOVERY account snapshot/)
      assert.deepEqual(
        error.recoveryFailure,
        recoveryFailure,
        "A poisoned Journal writer must not be downgraded to a retryable sync failure.",
      )
      assert.equal(error.cause, writeError, "The original Journal write error must remain in the cause chain.")
      return true
    },
  )

  assert.equal(fixture.publishedEvents.length, 1, "The uncertain recovery audit publication must remain intact.")
  assert.equal(fixture.getFlushCount(), 1, "A permanent write failure must not trigger an internal flush retry.")
})

test("treats a failed flush with unclassified Journal health as terminal", async () => {
  const market = createFixture().market
  const writeError = new Error("Journal flush failed without writer-health metadata")
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
    flushResults: [{
      ok: false,
      durable: false,
      errors: [writeError]
    }],
  })
  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "DURABILITY",
        stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH_UNCLASSIFIED",
        retryable: false,
      })
      assert.equal(error.cause, writeError)
      return true
    },
  )
})

test("retains the first recovery account audit publication after a transient flush failure and retry", async () => {
  const market = createFixture().market
  const syncFailure = new Error("simulated Journal file sync failure")
  const fixture = createFixture({
    accountSnapshots: [
      createAccountSnapshot({
        market,
        sourceTime: 100
      }),
      createAccountSnapshot({
        market,
        sourceTime: 101
      }),
    ],
    flushResults: [
      {
        ok: false,
        durable: false,
        errors: [syncFailure],
        recoveryFailure: {
          category: "DURABILITY",
          stage: "JOURNAL_FLUSH_FAILURE",
          retryable: true
        },
      },
      {
        ok: true,
        durable: true
      },
    ],
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.match(error.message, /Unable to durably persist RECOVERY account snapshot: simulated Journal file sync failure/)
      assert.deepEqual(error.recoveryFailure, {
        category: "DURABILITY",
        stage: "JOURNAL_FLUSH_FAILURE",
        retryable: true,
      }, "A transient Journal flush failure must be explicitly retryable only after a fresh recovery attempt.")
      return true
    },
    "A failed first Journal sync must reject the account audit even though its event publication already completed.",
  )

  assert.equal(
    fixture.publishedEvents.length,
    1,
    "The first recovery account audit event must remain published after its durability confirmation fails.",
  )
  assert.equal(
    fixture.publishedEvents[0].data.phase,
    "RECOVERY",
    "The first uncertain account audit event must retain its RECOVERY phase.",
  )
  assert.equal(
    fixture.getFlushCount(),
    1,
    "The first recovery account audit publication must attempt exactly one durability flush before failing.",
  )

  const retrySnapshot = await fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" })

  assert.equal(
    retrySnapshot.sourceTime,
    101,
    "The later recovery attempt must use the next authoritative account snapshot after the transient flush failure.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    2,
    "The retry must publish a second account audit rather than deleting or deduplicating the first uncertain publication.",
  )
  assert.notEqual(
    fixture.publishedEvents[0],
    fixture.publishedEvents[1],
    "The retry must create a distinct lifecycle event while preserving the original uncertain event object.",
  )
  assert.deepEqual(
    fixture.publishedEvents.map((event) => event.data.phase),
    ["RECOVERY", "RECOVERY"],
    "Both the uncertain first publication and successful retry publication must remain labeled as recovery audits.",
  )
  assert.equal(
    fixture.getFlushCount(),
    2,
    "The successful retry must perform a second flush that confirms durability for the retry sequence.",
  )
})


test("commits account balance and open-order facts before publishing their Journal audit events", async () => {
  const appendedRecords = []
  const operationalStateStore = {
    append: async (fact) => {
      appendedRecords.push(fact)
      return {
        ok: true,
        data: {
        durable: true,
        record: fact
      }
      }
    },
  }
  const market = createFixture().market
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
    operationalStateStore,
  })

  await fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })
  await fixture.manager.publishOpenOrdersSnapshot({
    phase: "PREFLIGHT",
    orders: []
  })

  assert.deepEqual(
    appendedRecords.map(({ factType }) => factType),
    ["ACCOUNT_SNAPSHOT_CAPTURED", "ACCOUNT_OPEN_ORDERS_CAPTURED"],
    "Both recovery-critical account snapshots must be committed to the Operational State Store record stream.",
  )
  assert.equal(fixture.publishedEvents.length, 2, "The existing Journal audit events must remain published after Operational State Store record acknowledgement.")
  assert.equal(fixture.getFlushCount(), 2, "The existing Journal flush barriers must remain in force after Operational State Store record commits.")
})

test("fails closed before Journal publication when the durable balance snapshot append is not acknowledged", async () => {
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market: createFixture().market,
      sourceTime: 100
    })],
    operationalStateStore: {
      append: async () => ({
        ok: false,
        errors: [new Error("simulated durable balance snapshot failure")]
      }),
    },
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" }),
    /Unable to durably persist account snapshot: simulated durable balance snapshot failure/,
    "A failed durable account fact must prevent the Journal publication and readiness barrier.",
  )
  assert.equal(fixture.publishedEvents.length, 0, "No Journal audit may imply durable recovery evidence when the fact append failed.")
  assert.equal(fixture.getFlushCount(), 0, "A failed durable fact must not advance to the Journal flush.")
})

test("fails closed before Journal publication when the durable open-order snapshot append is not acknowledged", async () => {
  const fixture = createFixture({
    operationalStateStore: {
      append: async () => ({
        ok: false,
        errors: [new Error("simulated durable open-order snapshot failure")]
      }),
    },
  })

  await assert.rejects(
    fixture.manager.publishOpenOrdersSnapshot({
      phase: "PREFLIGHT",
      orders: []
    }),
    /Unable to durably persist account open-orders snapshot: simulated durable open-order snapshot failure/,
    "A failed durable open-order fact must prevent the Journal publication and readiness barrier.",
  )
  assert.equal(fixture.publishedEvents.length, 0, "No Journal audit may imply durable open-order evidence when the fact append failed.")
  assert.equal(fixture.getFlushCount(), 0, "A failed durable open-order fact must not advance to the Journal flush.")
})


test("durably records a Binance NEW external order without inventing its Harvester identity", async () => {
  const operationalStateStore = []
  const externalOrder = {
    id: "external-new-order-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-client-order-1",
  }
  const fixture = createFixture({
    openOrders: [externalOrder],
    operationalStateStore: {
      append: async (fact) => {
        operationalStateStore.push(fact)
        return {
          ok: true,
          data: {
          durable: true,
          record: fact
        }
        }
      },
    },
  })

  await fixture.manager.publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })

  assert.equal(operationalStateStore.length, 1, "The external account-wide order snapshot must be committed as a durable fact.")
  assert.equal(operationalStateStore[0].factType, "ACCOUNT_OPEN_ORDERS_CAPTURED")
  assert.equal(operationalStateStore[0].data.readiness, "BLOCKED", "An external order remains an explicit blocked audit classification.")
  assert.equal(operationalStateStore[0].data.orders[0].status, "NEW", "The durable fact must preserve the exchange's active NEW status.")
  assert.equal(operationalStateStore[0].data.orders[0].clientOrderId, "manual-client-order-1", "The observed external client ID is evidence only and does not confer ownership.")
})


test("durably records a Binance NEW external order without treating its client ID as ownership", async () => {
  const operationalStateStore = []
  const fixture = createFixture({
    openOrders: [{
      id: "external-new-order-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      originalPrice: "65000",
      originalQuantity: "0.01",
      executedQuantity: "0",
      status: "NEW",
      clientOrderId: "manual-client-order-1",
    }],
    operationalStateStore: {
      append: async (fact) => {
        operationalStateStore.push(fact)
        return {
          ok: true,
          data: {
          durable: true,
          record: fact
        }
        }
      },
    },
  })

  await fixture.manager.publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })

  assert.equal(operationalStateStore.length, 1, "The external account-wide order snapshot must be committed as a durable fact.")
  assert.equal(operationalStateStore[0].factType, "ACCOUNT_OPEN_ORDERS_CAPTURED")
  assert.equal(operationalStateStore[0].data.readiness, "BLOCKED", "An external order remains an explicit blocked audit classification.")
  assert.equal(operationalStateStore[0].data.orders[0].status, "NEW", "The durable fact must preserve the exchange's active NEW status.")
  assert.equal(operationalStateStore[0].data.orders[0].clientOrderId, "manual-client-order-1", "An observed external client ID is evidence only and does not confer ownership.")
})


test("separates manual external orders from unresolved prior-process Harvester orders", async () => {
  const fixture = createFixture({
    openOrders: [
      {
        id: "manual-broker-order",
        symbol: "DOGEUSDT",
        side: "BUY",
        type: "LIMIT",
        originalPrice: "100",
        originalQuantity: "1",
        executedQuantity: "0",
        status: "NEW",
        clientOrderId: "manual-order-1",
      },
      {
        id: "prior-harvester-broker-order",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        originalPrice: "100",
        originalQuantity: "1",
        executedQuantity: "0",
        status: "NEW",
        clientOrderId: "h-0123456789abcdef012345-7",
      },
    ],
  })

  await fixture.manager.publishOpenOrdersSnapshot()

  assert.equal(fixture.manager.hasUnownedOpenOrdersForSymbol({ symbol: "DOGEUSDT" }), true, "Manual orders must be exposed to the configured per-pair policy.")
  assert.equal(fixture.manager.hasUnresolvedHarvesterOpenOrdersForSymbol({ symbol: "DOGEUSDT" }), false, "Manual orders must not be mistaken for unresolved Harvester orders.")
  assert.equal(fixture.manager.hasUnownedOpenOrdersForSymbol({ symbol: "BTCUSDT" }), false, "A prior-process Harvester order must not be classified as manual.")
  assert.equal(fixture.manager.hasUnresolvedHarvesterOpenOrdersForSymbol({ symbol: "BTCUSDT" }), true, "A prior-process Harvester order must remain a symbol-scoped blocker.")
})


test("times the CLOSING Journal durability barrier and reports failed flushes", async () => {
  const { market } = createFixture()
  const logEntries = []
  let tick = 0
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({
      market,
      sourceTime: 100
    })],
    logger: { system: (entry) => logEntries.push(entry) },
    monotonicNow: () => {
      tick += 7
      return tick
    },
  })

  await fixture.manager.publishAccountSnapshot({
    phase: "CLOSING",
    auditStatus: "COMPLETE"
  })

  const started = logEntries.find((entry) =>
    entry.shutdownPhase === "JOURNAL_DURABILITY_BARRIER" && entry.phaseStatus === "STARTED")
  const completed = logEntries.find((entry) =>
    entry.shutdownPhase === "JOURNAL_DURABILITY_BARRIER" && entry.phaseStatus === "COMPLETED")
  assert.ok(started, "The CLOSING audit must log when its Journal barrier starts.")
  assert.ok(completed, "The CLOSING audit must log when its Journal barrier completes.")
  assert.equal(completed.durationMs, 7, "The barrier duration must use the injected monotonic clock.")
  assert.equal(completed.phase, "CLOSING")
})
