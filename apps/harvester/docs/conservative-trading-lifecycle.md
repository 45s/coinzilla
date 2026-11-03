# Conservative trading lifecycle

## Required cycle

Harvester's Conservative policy follows the working Free-Roll recovery-first
sequence. It must not keep a standing BUY running while invested capital is
waiting to be recovered.

```text
No invested recovery capital
        |
        v
     BUY OPEN
        |
        v
     BUY FILLED
        |
        v
 Recovery SELL OPEN
        |
        v
 Recovery SELL FILLED
        |
        v
 Verify net profit and retain keepQuantity
        |
        v
 Reset recovery cycle
        |
        +------> next BUY becomes eligible
```

## Invariants

- At most one active BUY per market.
- At most one active recovery SELL per market.
- A BUY is eligible only when there is no active BUY, no active SELL, and
  outstanding recovery capital is zero.
- A BUY fill increases outstanding recovery capital. The next strategy
  evaluation must produce the recovery SELL, not another BUY.
- While a recovery SELL is active, ordinary market-price updates must not
  submit another BUY or replace the SELL.
- A successful SELL fill must pass the existing recovery completion checks
  (actual net proceeds, minimum profit, and retained free quantity) before the
  recovery ledger resets and another BUY becomes eligible.
- Partial fills do not advance the cycle; existing full-fill waiting and
  fill reconciliation rules remain unchanged.
- Unknown/external orders remain unowned and fail closed. Binance order
  matching remains based on the acknowledged broker order ID, preserving the
  locally generated canonical client ID and raw `c`/`C` event metadata.

## Regression coverage

`src/domain/strategies/conservative/conservative-strategy.test.js` covers:

- initial BUY when there is no invested recovery balance;
- SELL-only intent after a BUY fill with outstanding recovery;
- no BUY while a recovery SELL is active;
- no BUY while recovery capital remains outstanding even if no SELL is
  currently registered;
- no duplicate BUY while a BUY is active and no advancement on partial fills.

These tests validate policy decisions offline. They do not replace a bounded
Binance Spot TESTNET run of BUY submission/fill, recovery SELL
submission/fill, and the next BUY.

## Operator safety after runaway order creation

If repeated BUYs or recovery SELL replacements are observed:

1. Stop Harvester and confirm graceful shutdown.
2. Do not restart it until the account is inspected.
3. Use the read-only TESTNET open-orders, order-history, and balance tools to
   identify remaining orders and inventory.
4. Do not use the cancel-all or market-sell scripts as an automatic cleanup.
   Decide explicitly which orders to preserve or cancel and what inventory
   should remain.
5. Restart only after the strategy correction is fetched and the account's
   actual state is understood.

See the [Harvester README](../README.md) and [roadmap](../ROADMAP.md) for
startup requirements and the current acceptance status.
