# Harvester operations documentation

Start with the procedure matching the task. Do not treat a runbook as standing authorization to interact with TESTNET or place/cancel orders.

- [Local DEV reset and evidence archive](local-dev-reset-and-archive.md) — local debug archive collection and independent, lock-free publication — TESTNET-only archive publication, production-data exclusion, process-lock refusal, and recovery-facts-only reset.
- [Operational State Store diagnostics and incident investigation](operational-state-store-diagnostics.md) — default path and override, automatic first-start creation for a missing/empty directory, fail-closed partial-ledger handling, read-only integrity/projection diagnostic, and recovery boundaries.
- [Journal Operations](../JOURNAL_OPERATIONS.md) — Journal lifecycle, event inventory, PREFLIGHT/RECOVERY/CLOSING and targeted COMMISSION_BASELINE durability, process locks, shutdown ordering, failure diagnosis, and read-only Operational State integrity/projection diagnostics.
- [One-market recovery reconciliation](../recovery/README.md) — offline ADR-0001 Step 7 evidence bundle, audit-only CLI and explicit coverage confirmation.
- [Offline user-data ACCOUNT blocker resolution](../recovery/README.md#offline-user-data-account-blocker-resolution) — clean-stop requirement, all-configured-market audit, durable resolution/readback and controlled restart; never clears Recovery Seller STOP.
- [Error vocabulary](../error-vocabulary.md) — stable diagnostic identifiers, meanings and safe recovery steps.
- [Submission deferrals and missing-order diagnostics](submission-deferrals.md) — interpret successful-but-deferred results, stable gate reasons, structured logs, and LIMIT_MAKER safety.
- [Logging](../LOGGING.md) — cumulative and timestamped session files, shared process identity, stream lifecycle, logger levels and diagnostics.
- [Relational trading-history backups](trading-history-backups.md) — host-scheduled online backups, restore verification, retention and permissions.
- [TESTNET validation runbook](../TESTNET_VALIDATION_RUNBOOK.md) — CLOSED / PAUSED; the earlier two-pair DOGEUSDT/ZROUSDT plan omits two currently enabled TESTNET markets. The committed CG configuration enables TESTNET LINKUSDT, ZROUSDT, DOGEUSDT and ADAUSDT, plus LIVE LINKFDUSD, ZROFDUSD and WLDFDUSD. The runbook remains CLOSED / PAUSED; no replacement session scope is approved.
- [TESTNET order tools](../testnet-order-tools.md) — read-only diagnostics plus legacy ZROUSDT market-sell and account-wide cancel writes; neither write is authorized by the paused runbook. The account-wide cancel proceeds after a warning without interactive confirmation; the menu adds no confirmation layer. The menu's read-only exchange account audit and local Journal balance audit are documented in the runbook and Journal Operations.
- [Trading First](../TRADING_FIRST.md) — priority and non-negotiable trading safety constraints.
- [Operator control](../operator-control/README.md) — Telegram Command Center commands, authorization, durable acknowledgement, inline confirmation and process-lifetime scope.
- [Telegram Command Center operator runbook](telegram-command-center.md) — command menu, inline navigation, confirmed controls, authorization and troubleshooting.
- [Incident audit playbook](../INCIDENT_AUDIT_PLAYBOOK.md) — evidence capture and incident investigation workflow.

## Important safety boundaries

- Set `TRADING_MODE=testnet` for Binance Spot TESTNET or `TRADING_MODE=live` for Binance Spot LIVE. Binance is the only broker; trading is enabled in either mode and there is no separate trading-enable switch or runtime-profile selector. Missing or invalid mode fails startup. LIVE uses real funds and requires dedicated LIVE API credentials with withdrawals disabled. `NODE_ENV` does not select the exchange. Startup currently does not restore prior trading state after process restart; see #654.
- The committed CG configuration enables four TESTNET markets (LINKUSDT, ZROUSDT, DOGEUSDT and ADAUSDT) and three LIVE markets (LINKFDUSD, ZROFDUSD and WLDFDUSD). The old DOGEUSDT/ZROUSDT runbook plan omits two enabled TESTNET markets; it is historical, not an approved session scope. The regional HTTP 451 pause remains in force.
- With the shipped `components.recovery.enabled: false`, broker-connected startup does not construct, verify, read, or append ADR-0001 Operational State Store facts. Journal PREFLIGHT durability and the current account/open-order PREFLIGHT remain required before trading.
- The shipped recovery-off mode skips startup exchange-history backfill and application REST reconciliation after a user-data reconnect. A disconnect closes readiness; it is not auto-cleared by transport reconnect and remains blocked until a new process performs a fresh PREFLIGHT. Process-restart restoration remains disabled and tracked by [#654](https://github.com/45s/coinzilla).
- Recovery Seller execution and Telegram Command Center are suppressed while the master recovery component is off because both depend on durable operational-state facts.
- External/unowned orders and balances are not adopted automatically.
- Read-only tools do not authorize or imply permission to run destructive commands.
