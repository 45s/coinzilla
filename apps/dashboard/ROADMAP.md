# Dashboard application roadmap

**Owner:** Dashboard application
**Scope:** `apps/dashboard/`
**Tracking:** [Issue #1623](https://github.com/45s/coinzilla/issues/1623)

## Current milestone

- **In progress in [PR #1636](https://github.com/45s/coinzilla/pull/1636), tracked by [#1634](https://github.com/45s/coinzilla/issues/1634):** authenticated read-only Orders, Fills, and Commissions pages backed by Harvester's versioned API, with session-only token handling, backend-selected environment, filters, bounded pagination, record details, explicit connection/error/empty states, and frontend regression tests. This is a coordinated client/server delivery; Harvester retains API and persistence ownership.
- [ ] Initialize the Angular + TypeScript workspace, responsive shell, Overview screen, demo-only view models, tests and repository ownership/CI registration.
- [ ] Generate and commit the pnpm lockfile after local dependency installation.
- [ ] Verify Angular build and tests locally and through GitHub Actions on the exact task PR head.

## Future capability areas

These are planning areas, not commitments to bypass backend ownership or existing trading safety requirements:

- Authenticated, typed, read-only API integration for account snapshots, positions and service diagnostics.
- Environment-aware TESTNET/LIVE presentation with explicit backend-reported state and readiness.
- Reconnecting real-time event transport with snapshot reconciliation after disconnects.
- Searchable diagnostics views backed by server APIs.
- Order-entry and operator-control workflows only after the backend exposes authorized endpoints that use existing Harvester application use cases.
- Optional desktop packaging with Tauri after the web application and its API contracts are stable.

## Constraints

- Keep the browser a presentation/client layer; no direct database, broker or exchange integration.
- Keep feature modules independently testable and avoid introducing a global state framework before multiple features need shared state.
- Keep mock/demo fixtures clearly separated from production API models.
- Update this roadmap when the issue scope or delivered milestone changes. Do not use it as a chronological task log.
