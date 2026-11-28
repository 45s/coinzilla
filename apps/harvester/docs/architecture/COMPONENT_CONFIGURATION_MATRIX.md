# Harvester pre-launch component configuration matrix

**Scope:** startup-time application configuration in `apps/harvester/config/index.js`, validated by `validateAppConfig()` before runtime composition. Changes take effect on the next process launch. This is not a runtime toggle or kill-switch registry.

The shipped master setting is `components.recovery.enabled: false`. It disables the recovery-facts store and recovery workflows in Harvester's current runtime; it does not delete or modify any existing recovery-facts files.

The first newly explicit component selector is `components.tradingHistoryApi.enabled`, introduced in [PR #1966](https://github.com/45s/coinzilla/pull/1966). The `components` namespace is intentionally allow-listed: adding a component requires typed validation, a startup-composition guard, regression coverage, and a safety/dependency review.

## Configuration matrix

| Component / capability | Existing configuration | Default / current contract | Classification and safe boundary |
| --- | --- | --- | --- |
| Local Trading-history HTTP/WebSocket API | `components.tradingHistoryApi.enabled` | `true` | Optional local observer/API. `false` skips API and listener initialization. It does not disable the relational database, order/fill accounting, trading, reconciliation, or other runtime services. |
| Harvester recovery subsystem | `components.recovery.enabled` | `false` | Master OFF: no Operational State Store construction, verification, reads, or writes; no process/recovery facts; no startup exchange-history backfill; no user-data reconnect REST reconciliation; no Recovery Seller execution; and no Telegram Command Center. Existing recovery-facts files are left untouched. After a user-data disconnect, readiness remains closed until a new process performs a fresh initial PREFLIGHT. |
| Outbound Telegram notifications | `notifications.telegram.enabled` | `true` | Optional outbound observer. Bot token/chat ID remain environment-only. Outbound notifications are configured independently; the recovery master switch suppresses inbound operator control. |
| Inbound Telegram Command Center | `operatorControl.telegram.enabled` | `true` in source config; effective runtime OFF while `components.recovery.enabled=false` | The recovery master switch suppresses startup because operator commands depend on durable operational-state facts. When the master is enabled, the interface still requires a valid private-chat allowlist and environment-only bot token. |
| Conservative Coin Grabber strategy | `strategies.CG_coinGrabber.enabled`; `settings.conservative.enabled` | Both `true` | Mandatory executable strategy in the current release. Validation rejects `false`; this PR does not make it optional. |
| Aggressive strategy mode | `settings.aggressive.enabled` | `false` | Deferred. Validation rejects enabling it; do not expose as an available component. |
| CG process-restart recovery | `settings.recovery.enabled` | `false` | Deferred. Validation rejects enabling it until complete history discovery, authoritative reconciliation, readiness, and crash/restart acceptance exist. |
| Per-market CG / RS participation | `strategies.<id>.pairs.<symbol>.enabled` | Explicit per pair | Existing market-selection control, not a global strategy/component switch. Disabling a market does not prove its owned orders, inventory, or recovery obligations are settled. |
| Recovery Seller strategy | `strategies.RS_recoverySeller.enabled` | `true` in source config; effective runtime OFF while `components.recovery.enabled=false` | The master recovery switch suppresses all RS execution routes because RS requires the durable STOP workflow. No RS orders are submitted while the master switch is OFF. |
| Logging transports / diagnostic categories | No user-facing `appConfig` switch | Console INFO, DEBUG/TRACE file transports, and runtime-error buffer are composed by `configureHarvesterLogging()` | Required operational evidence. No generic disable flag is introduced. Diagnostic verbosity/category selection must never suppress mandatory WARN/ERROR, security, or audit records. |
| Journal | No user-facing `appConfig` switch; lower-level `prepareOptionalJournal({ enabled })` is a programmatic helper | Enabled by default composition | Broker-connected startup requires Journal readiness and durable flush capability. Its helper-level optional mode is not an operator-facing trading switch; do not disable it for trading. |
| Operational State Store | `components.recovery.enabled` | Not constructed while master recovery is OFF | No recovery-fact history is verified, read, appended, initialized, or restored. Existing files are not deleted or repaired. |
| Relational trading-history persistence | No global component-disable switch | Prepared independently from the local API | Continues to persist current-session order/fill events. The master recovery switch separately skips startup backfill from exchange order/trade history; disabling the local API does not disable persistence or change accounting ownership. |
| Broker/provider instances | `brokers.instances[]`, `required`, and `executionRouting.routes` | Provider identity/routes are explicit when configured; `required` defaults to required | Provider selection and startup-failure policy, not a generic feature flag. An optional provider failure must not silently reroute execution or make an uncovered market appear ready. |

## Validation and composition rules

1. Validate the complete named `appConfig` before acquiring runtime resources or starting providers.
2. Unknown component names, unknown component fields, and non-boolean `enabled` values fail with a path-specific `ConfigValidationError`.
3. Missing `components` remains backward-compatible for injected/legacy configurations; the shipped config explicitly sets the API default to `true`.
4. A disabled optional component is not constructed or started. Its shared dependencies are not disabled unless they have their own independently audited lifecycle and safety contract.
5. Trading, order/fill accounting, authoritative reconciliation, readiness gates, account STOPs, durable blockers, required Journal barriers, Operational State Store integrity, and mandatory logs are not controlled by this optional-component namespace.
6. Never infer safety from a disabled UI/observer/API, a missing provider, an unavailable history database, or an empty in-memory strategy registry.

## Source contracts

- [Application config validator](../../src/domain/app-config.js)
- [Shipped application config](../../config/index.js)
- [Trading-history API lifecycle](../../src/index.js)
- [Journal operations and durability contract](../JOURNAL_OPERATIONS.md)
- [Telegram Command Center operator contract](../operations/telegram-command-center.md)
- [Harvester roadmap](../../ROADMAP.md)
