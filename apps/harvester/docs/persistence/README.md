# Harvester ordinary persistence

**Tracking issue:** [#1327 — Provider-neutral DB API and Harvester persistence integration](https://github.com/45s/coinzilla/issues/1327)

**Current implementation:** filled-order history projection merged in [PR #1469](https://github.com/45s/coinzilla/pull/1469) as `39f098000d6c20cb596a9e6700250faa00bbd80e`.



**Relational trading history — implementation in progress:** [#1554](https://github.com/45s/coinzilla/issues/1554) delivers versioned physical `orders` and `fills` tables, source-preserving migration of the existing collection, and non-blocking persistence of canonical applied fills. Until migration verification and cutover are complete, the existing `harvester_orders` observer remains active. Startup exchange-history synchronization is explicitly deferred.

## Filled-order history

Harvester persists one record in the `harvester_orders` collection when a Harvester-owned order first has a positive cumulative executed quantity. This includes immediately partially/fully filled broker acknowledgements, later partial/final execution updates, and partially filled cancellation outcomes.

The stable record identity is the complete tuple:

`(environment, providerInstanceId, providerType, accountId, clientOrderId)`

The projection retains canonical market and asset identity, order side/type/status, broker and client order IDs, exact decimal quantities, optional price and cumulative quote quantity, lifecycle timestamps, source-event identity, and strategy/position ownership when available. Existing lifecycle snapshots update the same record; stale or duplicate source events cannot move the stored order backwards.

The observer listens to `order.submitted`, `order.updated`, `order.cancelled`, and `order.cancel_failed`. Its bounded serialized queue is best-effort and does not await database writes from broker submission, user-data handling, fill application, accounting, Journal, or trading-readiness paths. Queue overflow and persistence failures are logged as history gaps and do not block trading.

## Ownership and safety boundary

- Harvester owns the order-history model, repository port, lifecycle projection, and persistence composition.
- `@coinzilla/db` owns generic provider-neutral database contracts and adapters; no `packages/db` changes are part of this slice.
- SQLite is the only currently implemented provider. TESTNET and LIVE use separate environment-selected files.
- OrderRegistry remains authoritative for in-process order state. This projection is not used for restart restoration or trading decisions.
- Journal retains its existing ordered lifecycle-evidence contract.
- Harvester ADR-0001 (Application-owned recovery facts) remains separate and unchanged. SQLite does not replace it.
- No individual fill/commission ledger, second event ledger, recovery restoration, strategy change, broker API change, or exchange operation is introduced.

## Removed temporary persistence

The earlier trading-session-ID persistence and temporary `harvester_processes` process-ID smoke-test write are removed in this slice. Neither process ID nor runtime session ID is part of the filled-order history identity. This is ordinary historical reporting only, not a recovery-store migration.

## Verification and operational limitations

The implementation is covered by domain validation/transition tests, repository transaction and idempotency tests, real SQLite persistence and environment-isolation tests, observer queue/failure tests, lifecycle integration tests, and Harvester regression tests. Production deployment readiness is not implied: backup/restore, retention, permissions, disk monitoring, corruption/disk-full procedures, and operational recovery remain separate work.

## Historical design reference

[SQLite integration blueprint](./sqlite-integration-blueprint.md) is a source-verified design/audit snapshot from before the filled-order-history slice. Its trading-session-history implementation inventory is historical and does not describe the current persistence composition.
