# ZROUSDT / DOGEUSDT historical order synchronization identity conflicts

**Incident date:** 2026-11-25  
**Runtime:** Binance TESTNET  
**Related issue / PR:** [#1851](https://github.com/45s/coinzilla/issues/1851) / [#1849](https://github.com/45s/coinzilla/pull/1849)  
**Separate incident:** LINEAUSDT Recovery Seller authorization work in #1847 / #1848 is unrelated.

## Executive finding

The source inspection confirms two independent defects at the persistence boundary. First, Harvester treated clientOrderId as the permanent identity of an exchange order. The canonical identity and relational orders uniqueness constraint used environment, provider instance/type, account and clientOrderId, while the exchange broker order ID was only a lookup attribute. Second, immutable decimal facts such as price were compared as raw strings even though the decimal parser preserves the exchange's original formatting. Numerically equal values such as `65000.0` and `65000.0000` could therefore be rejected as different.

Binance Spot documents newClientOrderId as unique among open orders and explicitly permits reuse when the previous order is filled. The order endpoints also require symbol alongside orderId. Consequently, clientOrderId is not a permanent identity and an exchange order ID must be scoped by market.

The recovered logs prove that both ZROUSDT and DOGEUSDT failed at the same persistence boundary with the same error field and show the incoming broker/client IDs. They do not contain the pre-existing SQLite row, its broker order ID, or either conflicting price. Therefore both source-level defects are confirmed, but the logs cannot distinguish whether either symbol's specific conflict was a genuine different price routed to the same client-based row, or an equivalent price serialized with different decimal formatting. The exact original old-row/new-row pairing and actual price values for each symbol are not independently proven. The regression fixtures deliberately use synthetic prior IDs and prices.

Exchange contract: [Binance Spot REST trading endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints).

## Recovered runtime evidence

The 2026-11-25 lock records process 21168 started at 2026-11-25T18:17:28.442Z. The runtime session is f5d4f2a1-0bc1-453e-92bb-7bc05cfa82d8, branch develop, commit 24132a3f485efdc0a75c3bbcf4fd0e94778c79b9, working tree dirty.

At 2026-11-25T18:17:44.608Z, harvester(2).log records:

- ZROUSDT, broker order 661748, client order h-ZROUSDT-1.
- DOGEUSDT, broker order 1193792, client order h-DOGEUSDT-1.
- Error code HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED; underlying OrderHistoryIntegrityError code HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT; message Order-history integrity conflict: price.
- Both failures occurred at ORDER_RECORD_PERSIST on page cursor 0.
- ZROUSDT failed at 1-based record index 1000; last successfully persisted broker order ID 661725.
- DOGEUSDT failed at 1-based record index 53; last successfully persisted broker order ID 1193586.

The aggregate diagnostics report 1,646 orders observed and 1,211 persisted; 5 order pages and 3 fill pages were checked. LINKUSDT, ADAUSDT and LINEAUSDT were queried successfully. ZROUSDT and DOGEUSDT failed. History pages, market-history pages, market-universe completeness and retention coverage all remained unconfirmed; overall complete was false. No fills were observed or persisted in this failed startup scan.

The exact stack is:

- assertOptionalEqualField
- assertImmutableOrderFacts
- mergeOrderHistoryRecords
- upsertOrder
- persistCanonicalOrder
- persistOrderPage
- synchronizeOrders
- synchronizeAccountHistory
- synchronizeStartupExchangeHistory

The immutable price assertion runs before the broker-order-ID assertion. Thus a price mismatch can mask whether the persisted row also carried a different exchange order ID.

### Sanitized runtime excerpts

The surrounding Harvester log records successful market-rule validation for DOGEUSDT, ADAUSDT and LINEAUSDT at 18:17:31.359Z, 18:17:31.626Z and 18:17:31.898Z. At 18:17:44.608Z it records:

> ERROR — Exchange history synchronization failed; historical coverage is incomplete

> provider=binance / instance=binanceTestnet / account=binance-primary / environment=testnet / symbol=ZROUSDT / brokerOrderId=661748 / clientOrderId=h-ZROUSDT-1 / failureStage=ORDER_RECORD_PERSIST / errorCode=HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED

The same diagnostic's failures array contains both records:

- ZROUSDT: cursor 0, recordIndex 1000, lastPersistedOrderId 661725, errorCode HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT.
- DOGEUSDT: cursor 0, recordIndex 53, lastPersistedOrderId 1193586, errorCode HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT.

The nested causes for both records contain the exact message “Order-history integrity conflict: price”. The same event is present at line 24 of trace(2).log. Immediately afterward, the Harvester log records “Broker user-data delivery established” at 18:17:45.157Z and “Exchange account snapshot loaded” at 18:17:45.443Z; the history failure therefore did not stop those later startup steps, but it correctly left history coverage incomplete.

The relevant nested stack frames from trace(2).log are:

- assertOptionalEqualField — order-history-transition.js:39
- assertImmutableOrderFacts — order-history-transition.js:70
- mergeOrderHistoryRecords — order-history-transition.js:197
- upsertOrder — relational-order-repository.js:104
- persistCanonicalOrder — sync-orders.js
- persistOrderPage — sync-orders.js
- synchronizeOrders — sync-orders.js
- synchronizeAccountHistory — sync-acc-history.js
- synchronizeStartupExchangeHistory — start-harvester.js

### Evidence provenance and integrity

| Recovered artifact | Size | SHA-256 |
| --- | ---: | --- |
| trace(2).log | 4,628,943 bytes | d91697c3a1316065230f2d0525bed9adb37b9baeab70fad78876b9a100a11b68 |
| harvester(2).log | 4,455,621 bytes | 7aa6167c62d67c35a799312506eab39daf723f11521c2c254f0f95ddf4256ae1 |
| terminal(2).log | 4,182 bytes | 24fe53cc7900a9945e00a622ca8f0456d0c341abf81bec1296ad3376ab7fe0cd |
| .coinzilla-journal(2).lock | 53 bytes | d6b3629a7a6f34faf8d68caed423ee3b192af271fc6cc8b27acd1e1b3ee5e771 |
| trace(1).log | 20,881,580 bytes | 72fac88da3bdbab226d118a07a022b3d9e202eed344df052416cd9bdac7321f0 |
| harvester(1).log | 20,597,614 bytes | 34b370c908b35f8c061dc8a0d797ff3dd91b968a659b034cbd2d8cc17edfdfca |
| terminal(1).log | 17,567 bytes | 990c5c7eb82d166ca935825c3caf1d85e57106b73e800ac9c7dffd5698941cfd |
| 2026-11-19_02-16-31-aeb1df6f-bc55-4287-96c5-096e7a6c1840.jsonl | 282,912 bytes | dcb22a5fdc9cf6ac834fa180d799d2e9e47d260dceb956df381b5efa1f554ff0 |
| .coinzilla-journal(1).lock | 53 bytes | 2ae0bcb9ef4a1269d8ff1d90b2e6d3c454969445eeeb415b33e8e57b97408508 |
| coinzilla-testnet-session-audit-2026-11-19.md | 14,646 bytes | beb3d0c4cb2a596e59aabcc655de88d904c75b1aee59a65a3f2a0df317760d4b |

The November 19 session is a separate run: session aeb1df6f-bc55-4287-96c5-096e7a6c1840, commit 72aed890fbe50f05b9e6608e6e755e900898d0e7, clean working tree. Its Journal records an open-orders capture with session-generated client IDs. Searches of the November 19 trace, Harvester log and Journal found no h-ZROUSDT-1, h-DOGEUSDT-1, 661748, 1193792, or the 2026-11-25 price-conflict stack. Those files provide historical context, not the missing persisted-row evidence for this incident.

No SQLite database dump or raw pre-existing order row for either conflict was available in the recovered Library artifacts. No database contents were inferred from filenames or previous summaries.

## Source trace and failure mechanism

At develop commit 1f55d5989e8122421f4d9e37693f68f32e0c29ed:

1. createOrderHistoryId generated the order ID from environment, provider instance/type, account and clientOrderId.
2. The relational orders table enforced permanent uniqueness on the same client-order tuple.
3. upsertOrder read and merged by that client-based primary ID.
4. mergeOrderHistoryRecords correctly treated price as immutable and rejected a changed price.
5. Decimal parsing validated values but preserved their source strings. assertOptionalEqualField compared price with JavaScript string equality, so trailing-zero/notation differences were treated as immutable price changes. fill-history-repository also resolved order references by the client-based order ID.
6. Startup pagination already tracked exchange order IDs, and fill history already carried broker order IDs. The stable exchange identity was available but was not used consistently at the persistence boundary.

The immutable price guard is still necessary. Two different exchange orders can be routed to the same client-based row before validation, and raw string comparison can reject numerically equal decimal values. The implementation fixes both mechanisms without accepting a genuinely different price.

## Corrected behavior

- Exchange-identified order identity is environment + provider instance/type + account + market + exchange order ID.
- clientOrderId remains an immutable correlation attribute checked when the same exchange order is merged. It is not the permanent identity.
- Orders without an exchange ID use a provisional client identity. A provisional row can be promoted only when the same scoped pending client identity and creation timestamp agree; ambiguous matches fail closed.
- The relational migration removes permanent clientOrderId uniqueness, adds a unique market-scoped exchange-order index and a partial unique index for pending client identities.
- Migration v5 rebuilds orders, fills and fill_commissions transactionally, copies every row and preserves primary keys and foreign-key links. A populated v4 database receives a pre-v5 SQLite backup verified by integrity_check and SHA-256 of order/fill/commission rows. Duplicate exchange identities or foreign-key violations abort the migration; there is no automatic row repair.
- Fills link to orders by exact provider/account/environment/market/exchange order ID. clientOrderId is validated when supplied, not used to choose among multiple orders. Fills arriving before orders remain unlinked until the matching exchange order is persisted.
- Decimal facts are compared with exact decimal arithmetic, not floating-point conversion or raw string equality. Numerically equivalent representations are accepted and the already-persisted representation is retained to avoid formatting churn. Genuinely different prices or original quantities remain fatal immutable-data conflicts. Duplicate execution snapshots compare executed and remaining quantities numerically; mutable execution/status fields can advance for the same exchange order.
- A rejected conflict reports reconciliationDecision=rejected, recoverable=false and coverageIncomplete=true. A failed page is not advanced; failed markets keep history coverage incomplete.

## TDD and regression evidence

The test-only RED stage reproduced:

- Domain identity collision: two different broker order IDs with the same observed ZRO/DOGE client IDs generated identical canonical IDs.
- Pending-to-ack identity collision: client-only and exchange-identified order forms collided.
- Relational ZRO/DOGE persistence collision: the second distinct exchange order was rejected as an immutable price conflict.
- Fill-before-order collision: two fills with the same client ID but different exchange order IDs could not be safely linked to their own order rows.
The RED fixtures use the observed incoming client and broker IDs; prior-order broker IDs and all decimal prices/quantities are synthetic and are not represented as recovered production values. After the initial identity RED checkpoint, source inspection also found raw-string decimal comparisons. Additional regression tests now cover equivalent price/original-quantity strings, duplicate execution snapshots with different trailing-zero formatting, omitted optional facts, and genuine numeric conflicts; these supplemental decimal tests were added with the decimal fix rather than being part of the initial RED checkpoint. GREEN tests prove that distinct exchange orders persist separately, equivalent decimal representations remain idempotent without rewriting stored formatting, genuinely different same-order prices still fail, repeated sync is idempotent, partial-fill state advances, and fills link to the exact exchange order after arriving first.

## Safety and unresolved limitations

The investigation and implementation use recovered logs, source inspection, GitHub-hosted deterministic tests and SQLite test databases only. No TESTNET/LIVE order placement, exchange writes, account mutations, cancellation, transfer, production restart, or historical row repair was performed.

The exact existing SQLite row and actual conflicting price pair for ZROUSDT and DOGEUSDT remain unavailable. The source-level identity defect and deterministic reproduction are established; the per-symbol production pairing remains an explicit evidence limitation rather than an invented fact.
