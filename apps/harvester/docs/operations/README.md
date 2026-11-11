# Harvester operations documentation

Start with the procedure matching the task. Do not treat a runbook as standing authorization to interact with TESTNET or place/cancel orders.

- [Journal Operations](../JOURNAL_OPERATIONS.md) — Journal lifecycle, event inventory, PREFLIGHT/CLOSING durability, process locks, shutdown ordering and failure diagnosis.
- [Error vocabulary](../error-vocabulary.md) — stable diagnostic identifiers, meanings and safe recovery steps.
- [Logging](../LOGGING.md) — cumulative and timestamped session files, shared process identity, stream lifecycle, logger levels and diagnostics.
- [TESTNET validation runbook](../TESTNET_VALIDATION_RUNBOOK.md) — CLOSED / PAUSED; the earlier DOGEUSDT/ZROUSDT scope no longer matches the LINKFDUSD-only default config. Reconcile before any future session.
- [TESTNET order tools](../testnet-order-tools.md) — read-only diagnostics plus legacy ZROUSDT market-sell and account-wide cancel writes; neither write is authorized by the paused runbook. The account-wide cancel proceeds after a warning without interactive confirmation; the menu adds no confirmation layer. The menu's read-only exchange account audit and local Journal balance audit are documented in the runbook and Journal Operations.
- [Trading First](../TRADING_FIRST.md) — priority and non-negotiable trading safety constraints.
- [Incident audit playbook](../INCIDENT_AUDIT_PLAYBOOK.md) — evidence capture and incident investigation workflow.

## Important safety boundaries

- Set `TRADING_MODE=testnet` for Binance Spot TESTNET or `TRADING_MODE=live` for Binance Spot LIVE. Binance is the only broker; trading is enabled in either mode and there is no separate trading-enable switch or runtime-profile selector. Missing or invalid mode fails startup. LIVE uses real funds and requires dedicated LIVE API credentials with withdrawals disabled. `NODE_ENV` does not select the exchange. Startup currently does not restore prior trading state after process restart; see #654.
- The committed default config currently enables only LINKFDUSD; the runbook's earlier DOGEUSDT/ZROUSDT plan is historical and not an approved session scope. The regional HTTP 451 pause remains in force.
- Broker-connected startup requires the Journal PREFLIGHT audit and durable flush.
- Current startup does not restore prior Portfolio/RecoveryLedger/OrderRegistry state from Journal history; process-restart reconciliation remains tracked by [#654](https://github.com/45s/coinzilla/issues/654).
- External/unowned orders and balances are not adopted automatically.
- Read-only tools do not authorize or imply permission to run destructive commands.
