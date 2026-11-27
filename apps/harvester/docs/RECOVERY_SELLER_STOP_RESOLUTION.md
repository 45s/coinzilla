# Recovery Seller STOP resolution

## Preconditions

Resolve an investment-only STOP only after the root cause is fixed and the operator has reviewed fresh authoritative account-wide reconciliation. The evidence must:

- identify the exact durable STOP blocker (one blocker only);
- cover every configured market;
- reconcile all orders, fills, and balances;
- contain zero unresolved orders/fills and zero balance discrepancies;
- be no more than five minutes old;
- verify Portfolio, legacy inventory, and reservations are consistent.

The STOP resolution command authenticates the local operating-system account. The supplied `operatorId` must match the current OS user; copying `operatorId` or `authMethod` fields is not authentication.

## Offline command

From `apps/harvester`:

```sh
node scripts/recovery-seller-stop.js --context <evidence.json> --operator-id <local-user> --action-id <unique-id> --resolution-reason <text> --cause-fixed
```

The evidence context is an operator-reviewed JSON file with:

- `runtimeSessionId`: the stopped runtime's durable session ID;
- `blockerId`: the exact 64-character durable STOP blocker ID;
- `reconciliation`: authoritative source/scope/status, configured and audited market lists, reconciliation ID/time, completeness flags, and zero unresolved/discrepancy counts;
- `accounting`: verified Portfolio/legacy/reservation consistency flags.

The command stamps the authenticated OS-account identity and action metadata, appends the resolution fact, and verifies the exact durable readback. It does not query exchanges, submit/cancel orders, mutate recovery facts, restart the process, or reset runtime state.

## After resolution

Successful durable resolution clears the durable STOP state but keeps both in-process BUY and SELL admission gates closed. The command reports `readiness: BLOCKED` and `requiresControlledRestart: true`. It does not resume trading.

A separate controlled restart must perform fresh authoritative reconciliation and PREFLIGHT before execution. The Telegram operator facade remains read-only for STOP status.

## Verification

The implementation branch is synchronized with the latest `develop` before exact-head CI. This is an offline resolution workflow only; no LIVE/TESTNET or operational restart acceptance is implied.
