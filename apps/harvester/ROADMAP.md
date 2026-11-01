# Harvester Roadmap

## 1. Product and strategy design

- [x] Define Harvester as an independent Node.js cryptocurrency-trading process.
- [x] Establish two initial strategy modes: Conservative (Free-Roll) and Aggressive.
- [x] Document the shared-engine / strategy-specific-policy boundary.
- [x] Document the distinction between domain entities, domain policies, application use cases, and infrastructure adapters.
- [~] Document mandatory AI-agent implementation guidance using dependency-injected use-case factories, domain boundaries, adapters, and bootstrap composition (PR #405; mark complete after merge).
- [x] Define and document the initial fill-driven Portfolio domain boundary.
- [ ] Agree on the Conservative mode contract by adapting the existing Free-Roll specification to Harvester.
- [~] Define Aggressive order-level behavior. The initial grid-style cycle, immediate placement of the full BUY grid, one-grid-per-market rule, fixed reference-based levels, upward repricing by all crossed `priceStep` levels, replacement-grid capacity checks, multiple active BUY/SELL orders, shared inventory, partial-SELL threshold, BUY-fill SELL eligibility (>50% cumulative BUY fill and >$5 USD-equivalent notional, otherwise wait for full BUY fill), separate SELL orders, and Conservative fallback are documented. BUY/SELL tick rounding is agreed (BUY down, SELL up); exact percentage-step calculation and remaining order/fee edge cases are still open.
- [x] Decide that Aggressive BUY executions create/update SELL exposure, while SELL orders reserve quantities from a shared per-market inventory pool (not exclusive BUY-owned lots).
- [~] Define Aggressive risk limits and fallback behavior. Maximum invested quote and maximum price drop are agreed as triggers for switching to Conservative; the price-drop baseline is the average price of actually filled BUY orders, while the exact percentage calculation remains open. The BUY-grid replacement check counts already invested quote plus the proposed grid's unfilled quote commitment; the current grid is retained if the complete replacement grid does not fit.
- [~] Define position ownership and allocation across pairs, strategies, and shared spot assets. Aggressive uses a shared inventory pool per market; cross-strategy and cross-market allocation remains open.
- [ ] Define accounting fields: invested quote, cost basis, realized profit, reserved quantity, and strategy-owned inventory.
- [ ] Decide how third-asset commissions and duplicate fills are represented and handled.

## 2. Shared trading engine

- [ ] Define domain contracts for markets, orders, fills, balances, positions, and strategy decisions.
- [x] Define the Harvester-owned broker port and implement the Binance infrastructure adapter around `@coinzilla/brokers`.
- [x] Wire opt-in broker connection and graceful shutdown through bootstrap; add offline port, adapter, and lifecycle tests.
- [ ] Implement market-data validation, user-data event handling, and recovery-gated trading workflows.
- [ ] Implement validated market data and exchange trading-rule handling.
- [ ] Implement order lifecycle handling, including partial fills, cancellations, rejections, and cancel/replace races.
- [ ] Implement fill normalization, deduplication, and accounting from actual commissions.
- [ ] Implement `src/domain/portfolio/` and `src/use-cases/update-portfolio.js` with deterministic tests.
- [ ] Add journal, readiness states, pause controls, and operational safety checks.
- [ ] Define persistence and restart/reconciliation requirements before implementing recovery.

## 3. Strategy implementations

- [ ] Implement Conservative (Free-Roll) strategy behind the shared engine contracts.
- [ ] Implement Aggressive strategy behind the shared engine contracts.
- [ ] Add deterministic unit tests for strategy decisions and boundary conditions.
- [ ] Add broker contract and integration tests; live exchange tests must be explicitly opt-in.

## 4. Foundation and delivery

- [x] Initialize the app as a private Node.js ESM workspace package.
- [x] Add initial trading-config loading and pure structural validation.
- [x] Add fail-fast startup bootstrap and CLI entry point; startup validates configuration but does not launch an unimplemented trading workflow.
- [ ] Replace the copied Free-Roll config baseline with an agreed Harvester configuration schema.
- [ ] Keep dependencies minimal and follow repository engineering standards.
- [ ] Update this roadmap as decisions are closed and functionality is verified.

## Delivery rules

- Follow repository root guidance and `apps/harvester/AGENTS.md`.
- Do not implement unresolved strategy behavior by assumption.
- Do not mark work complete until implementation and required checks pass on `develop`.
- Keep live trading disabled by default; tests must never place live orders.
