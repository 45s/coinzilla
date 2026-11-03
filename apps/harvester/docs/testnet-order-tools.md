# Binance Spot TESTNET order scripts

These standalone package scripts let an operator inspect or clear open orders in a Binance Spot TESTNET account without adding diagnostics or cancellation behavior to Harvester's trading runtime.

They use Node.js built-in `fetch` and `node:crypto`; no dependency is added. The API host is hard-coded to `https://testnet.binance.vision`. The scripts cannot be pointed at Binance production through environment configuration.

## Prerequisites

1. Stop Harvester and any other process that may submit or manage orders before running the cancellation command.
2. Copy `apps/harvester/.env.example` to `apps/harvester/.env.development` if you have not already done so.
3. Put your Binance Spot TESTNET API key and secret in that local file:
   - `BINANCE_API_KEY`
   - `BINANCE_API_SECRET_KEY`
4. The API key must have permission to read account/open-order information. The cancellation command also requires trading permission.
5. Keep `.env.development` local and never commit or share its credentials.

The scripts use signed requests with a 5-second receive window and a 15-second request timeout. API keys are sent in the `X-MBX-APIKEY` header. Secrets and signatures are not printed.

## List all open orders (read-only)

Run from the repository root:

```sh
pnpm --filter @coinzilla/harvester testnet:orders
```

The command calls `GET /api/v3/openOrders` without a symbol, so it lists open orders across all symbols. It prints the symbol, order ID, side, type, price, original quantity, executed quantity, status, and client order ID. It does not change the account.

## Cancel all open orders (destructive)

Run from the repository root:

```sh
pnpm --filter @coinzilla/harvester testnet:cancel-orders
```

The command:

1. Fetches and displays the current open orders across all symbols.
2. Stops without making changes if there are no open orders.
3. Requires the exact phrase `CANCEL ALL TESTNET ORDERS`.
4. Calls `DELETE /api/v3/openOrders` once for each symbol found in the initial snapshot.
5. Fetches open orders again and reports whether any remain.

**This is account-wide in effect:** every open order on every symbol found in the snapshot is targeted, including orders placed manually or by another application. Review the displayed list and stop all trading processes first. Do not run this command if any order must be preserved. It does not cancel orders created after the initial snapshot, so the final verification is essential. A failed cancellation or any remaining order produces a non-zero exit code.

The command does not sell, transfer, or otherwise change asset balances. Canceling an order may release its locked balance, but existing free base-asset inventory remains and can still prevent Harvester's clean-account startup check from passing.

## Troubleshooting

- **Missing credentials:** confirm both variables exist in `apps/harvester/.env.development`; do not paste secrets into chat or logs.
- **API-key permission error:** verify the TESTNET key has the required read permission for listing and trading permission for cancellation.
- **Timestamp/receive-window error:** check the computer's system clock and retry.
- **Remaining orders:** inspect the final table. Do not assume a cancellation succeeded merely because one symbol's request returned successfully.
- **Harvester still refuses startup:** these scripts only inspect/cancel open orders. They do not clear pre-existing base-asset inventory or disable Harvester's safety checks.

## Implementation boundary

All files for these tools live under `apps/harvester/scripts/`; none are imported by `src/` or composed into the trading runtime. The shared request helper fixes the API host to Spot TESTNET and signs requests locally. Unit tests cover deterministic request signing; the default test suite does not make network calls or require credentials.


## List non-zero account balances (read-only)

Run from the repository root:

```sh
pnpm --filter @coinzilla/harvester testnet:balances
```

The command calls the signed Spot TESTNET endpoint `GET /api/v3/account`,
then displays every asset whose free or locked amount is non-zero. It prints
the exact decimal strings returned by Binance (without rounding), including
the asset symbol, free amount, and locked amount. Assets with both amounts
equal to zero are omitted.

This is a read-only account inspection. It does not place or cancel orders,
transfer funds, or otherwise change balances. It is useful for diagnosing
Harvester's clean-account gate: canceling open orders can release locked funds,
but it does not remove existing free base-asset inventory. Do not sell or
transfer an asset merely to satisfy the gate until you have independently
identified and understood that inventory.

The script is under `scripts/`, outside the trading runtime. Its filtering
logic is a plain pure function with deterministic offline tests. The API call
reuses the shared TESTNET request helper and remains fixed to the TESTNET host.


## Sell all free ZRO at market (destructive)

Run from the repository root:

```sh
pnpm --filter @coinzilla/harvester testnet:sell-zro
```

The command is a standalone Binance Spot TESTNET operator tool, not part of
Harvester's trading runtime. It is fixed to the TESTNET API host and the
`ZROUSDT` market. The default run is a preview only. To submit, confirm the
exact phrase `SELL ALL FREE ZRO ON TESTNET` when prompted.

Before submission it reads the current free ZRO balance, loads the symbol's
market quantity filters, rounds the quantity down using exact decimal
arithmetic (preserving the maximum precision supplied by the balance and
exchange filters), and displays the quantity that will be sold. It refuses to
continue when the market is not trading, the available quantity is below
the market minimum, or open orders exist for `ZROUSDT`. After confirmation
it refreshes the balance and open orders; if the sellable quantity changed,
it aborts and requires a new preview/confirmation.

Only the free ZRO balance is eligible. ZRO locked in any order is not sold;
cancel and inspect those orders separately if you intend to release it.
The market order executes at the available market price and does not
guarantee a particular execution price. The script does not cancel orders,
transfer assets, or affect other symbols. Review the preview carefully:
this command sells the entire displayed free ZRO quantity.

The command is implemented by `scripts/sell-testnet-zro.js`; its exact
quantity validation and step-size rounding live in the pure
`scripts/testnet-sell-utils.js` module and are covered by
`scripts/testnet-sell-utils.test.js`. It reuses the shared signed TESTNET
request helper. No live trading host or production mode is configurable.


### Exchange metadata request behavior

The ZRO sell preview reads `GET /api/v3/exchangeInfo` using the public
TESTNET market-data request path. This endpoint must receive only its supported
parameters (here, `symbol`); it must not receive signed-account metadata such
as `timestamp`, `recvWindow`, or `signature`. Account, open-order, and order
submission endpoints continue to use signed requests. The shared helper keeps
these two request types separate and tests that public query construction
does not add authentication parameters.


## List recent order history (read-only)

Run from the repository root:

```sh
# Latest 20 orders for the default ZROUSDT symbol
pnpm --filter @coinzilla/harvester testnet:history

# Latest 50 orders for ZROUSDT
pnpm --filter @coinzilla/harvester testnet:history ZROUSDT 50

# Latest 20 orders for another symbol
pnpm --filter @coinzilla/harvester testnet:history -- BTCUSDT 20
```

The command calls the signed Spot TESTNET endpoint `GET /api/v3/allOrders`.
Binance requires one symbol per request, so this tool does not return a
mixed-symbol account-wide history. The default symbol is `ZROUSDT`; the
default limit is 20 and the accepted limit is 1-1000. Binance returns the
most recent orders up to the requested limit; the script displays them
newest-first.

When passing arguments through `pnpm run`, do not insert an extra `--` before
`SYMBOL` and `LIMIT`; that separator is forwarded to this script and becomes
an unexpected first argument. For example, from `apps/harvester`, run
`pnpm run testnet:history ZROUSDT 50`.

The table includes exchange time, order ID, symbol, side, type, price,
original quantity, executed quantity, cumulative quote quantity, status,
and client order ID. Decimal values are printed exactly as returned by
Binance. Historical orders can have a negative cumulative quote quantity
when Binance does not have that value available.

The endpoint includes active, canceled, and filled orders, as well as other
exchange-recorded terminal statuses such as rejected or expired orders.
It is read-only and does not place, cancel, or modify orders.

**Diagnostic limitation:** a submission rejected before Binance creates an
order may not appear in order history. Preserve the original broker/API
error code and message in Harvester diagnostics when investigating an
order-submission failure. An empty order-history result does not prove that
a failed submission was never attempted.

The command is implemented by
`scripts/list-testnet-order-history.js`. Its argument parsing and order
normalization/sorting are plain pure functions in
`scripts/testnet-order-history-utils.js`, with deterministic offline tests.
It reuses the existing signed TESTNET request helper and does not add
dependencies or connect to the trading runtime.
