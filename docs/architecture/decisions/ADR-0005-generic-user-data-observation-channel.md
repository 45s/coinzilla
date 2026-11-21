# ADR-0005: Generic native-event and polling-observation delivery

- Status: Accepted
- Date: 2026-11-19
- Owner: Harvester and Brokers
- Supersedes: ADR-0004 only for the generic broker user-data callback contract; its provider-admission restrictions remain in force
- Related: [Issue #1185](https://github.com/45s/coinzilla/issues/1185)

## Context

Binance provides an authenticated native user-data event stream. Bitunix Spot documents authenticated REST reads and private WebSocket RPC, but no continuous private order/execution push stream. A private polling reconciler can produce useful, explicitly scoped observations, but those observations do not have source timestamps, cannot replay transient states between polls, do not establish complete fill history, and cannot provide an authoritative account snapshot.

The project needs one provider-neutral Broker API without pretending these delivery guarantees are equivalent. Harvester must not inspect provider source code, branch on provider names, synthesize exchange events, or treat polling observations as authoritative execution facts.

## Decision

1. **Use one generic subscription method.** Providers expose `subscribeForUserData({ symbols?, trackedOrders?, onEvent, onObservation, onStatus })`. Optional scope inputs are ignored by providers that do not need them.
2. **Keep delivery channels semantically separate.**
   - `onEvent` receives native exchange events only. Binance uses its authenticated WebSocket stream and returns `deliveryMode: "NATIVE_EVENTS"` with `nativePush: true`.
   - `onObservation` receives non-authoritative observations only. Bitunix Spot uses the private REST polling reconciler and returns `deliveryMode: "POLLING_OBSERVATIONS"` with `nativePush: false`.
   - `onStatus` reports lifecycle, recovery, freshness and polling health.
3. **Represent capabilities independently.** `SUBSCRIBE_USER_DATA` means native private event delivery. `OBSERVE_USER_DATA` means explicitly scoped polling observations. Bitunix declares `OBSERVE_USER_DATA: SUPPORTED` and `SUBSCRIBE_USER_DATA: UNSUPPORTED`. Binance declares the inverse.
4. **Keep observations out of canonical execution accounting.** Harvester passes both callbacks through its application-owned BrokerPort. Its native event handler remains the only path to the canonical user-data event queue, order/fill accounting, and event-driven trading state. The observation handler records safe metadata only; it has no access to user-data state, order accounting, the canonical event publisher, or trading readiness.
5. **Do not infer delivery from provider identity.** Harvester never inspects provider source code or branches on provider names to choose a delivery method. The broker implementation invokes the appropriate callback and declares its delivery metadata.
6. **Preserve fail-closed provider admission.** Bitunix remains unregistered in Harvester while issue #1185's complete provider contract is unresolved. Polling observations cannot satisfy native `SUBSCRIBE_USER_DATA`, `getAccountSnapshot()`, canonical fill, reconciliation, or readiness requirements. No execution route, market-data route, or trading readiness may be enabled by the observation channel.
7. **Keep polling read-only and explicitly scoped.** Bitunix polling requires explicit symbols and only queries matching-order details for explicitly tracked order identities. It does not place/cancel orders, fabricate Binance `executionReport` events, claim complete history, or claim source timestamps.

## Alternatives considered

- **Convert polling snapshots into synthetic native events.** Rejected because it fabricates exchange lifecycle facts, can miss transient states, and can corrupt canonical fill/accounting state.
- **Mark Bitunix native `SUBSCRIBE_USER_DATA` supported because polling exists.** Rejected because the capability would claim a guarantee the exchange does not document.
- **Add a Bitunix-specific Harvester observer runtime or provider facade.** Rejected because it creates a second integration surface and conflicts with the standard provider architecture.
- **Make Harvester inspect provider identity or implementation source to choose a method.** Rejected because it couples application orchestration to infrastructure internals.

## Consequences

- Entities owns the exchange-neutral `OBSERVE_USER_DATA` capability vocabulary.
- Brokers owns the Bitunix polling reconciler and provider capability declaration.
- Harvester owns the separate diagnostic-only observation handler and passes both callback channels through its generic BrokerPort.
- Bitunix remains unavailable for Harvester execution and strategy market-data routing until the remaining #1185 prerequisites are independently completed and verified.
- Existing account snapshot, native event recovery, canonical fill, order ownership, and startup readiness barriers are unchanged.

## Verification

Required regression evidence includes:

- Bitunix observations are delivered only through `onObservation`; `onEvent` is never invoked.
- Binance native events remain delivered through `onEvent` and are declared `NATIVE_EVENTS`.
- Capability declarations distinguish `OBSERVE_USER_DATA` from `SUBSCRIBE_USER_DATA`.
- Harvester forwards the callbacks separately; observations do not enter the canonical event queue, publish fills, or open readiness.
- Bitunix subscriptions require explicit symbol scope and stop cleanly on disconnect.
- Offline tests perform no exchange writes. No Bitunix TESTNET is assumed or required.
