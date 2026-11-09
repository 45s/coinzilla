# Harvester operations documentation

Start with the procedure matching the task. Do not treat a runbook as standing authorization to interact with TESTNET or place/cancel orders.

- [Journal Operations](../JOURNAL_OPERATIONS.md) — Journal lifecycle, event inventory, PREFLIGHT/CLOSING durability, process locks, shutdown ordering and failure diagnosis.
- [Logging](../LOGGING.md) — cumulative and timestamped session files, shared process identity, stream lifecycle, logger levels and diagnostics.
- [TESTNET validation runbook](../TESTNET_VALIDATION_RUNBOOK.md) — controlled, jointly authorized validation procedure and abort conditions.
- [TESTNET order tools](../testnet-order-tools.md) — read-only account/order/trade inspection and explicitly destructive TESTNET operator scripts.
- [Trading First](../TRADING_FIRST.md) — priority and non-negotiable trading safety constraints.
- [Incident audit playbook](../INCIDENT_AUDIT_PLAYBOOK.md) — evidence capture and incident investigation workflow.

## Important safety boundaries

- Set `TRADING_MODE=testnet` for Binance Spot TESTNET or `TRADING_MODE=live` for Binance Spot LIVE. Binance is the only broker; trading is enabled in either mode and there is no separate trading-enable switch or runtime-profile selector. Missing or invalid mode must fail startup. LIVE uses real funds and requires dedicated LIVE API credentials with withdrawals disabled. The runtime resolver on this branch still uses the older `NODE_ENV` profile implementation until updated. Startup currently does not restore prior trading state after process restart; see #654.
- Broker-connected startup requires the Journal PREFLIGHT audit and durable flush.
- Current startup does not restore prior Portfolio/RecoveryLedger/OrderRegistry state from Journal history; process-restart reconciliation remains tracked by [#654](https://github.com/45s/coinzilla/issues/654).
- External/unowned orders and balances are not adopted automatically.
- Read-only tools do not authorize or imply permission to run destructive commands.
