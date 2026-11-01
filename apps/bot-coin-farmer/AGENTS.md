# Coin Farmer application agent instructions

This directory is owned by the Coin Farmer application domain. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, and this application's `ROADMAP.md` before making changes.

## Ownership

Owned path: `apps/bot-coin-farmer/**`

Coin Farmer owns its source, configuration, application workflows, domain policy, runtime, tests, state and release gates. Free-Roll is a read-only behavior reference; do not import its application code or reuse its process state.

## Local engineering rules

- Follow the architecture in `docs/architecture/COIN_FARMER_ARCHITECTURE.md` and module contracts in `docs/architecture/MODULE_CATALOG.md`.
- Keep the public entry point thin. Bootstrap is the composition root; config loading/validation stays separate.
- Keep domain policy pure and CEX-agnostic. Binance payloads and SDK types belong only in the Binance infrastructure adapter.
- Use canonical shared entities after reviewing their actual constructors, exports and tests. Do not create duplicate financial entities.
- Use exact decimal representations for all financial values; never use JavaScript Number arithmetic for prices, quantities, fees or P&L.
- Do not enable order placement until the roadmap's safety gates and explicit release authorization are satisfied.
- Add deterministic native Node.js tests for every new behavior. Tests must not require credentials, network access or live exchange services.
- Do not add dependencies without a concrete need; prefer existing workspace packages and Node.js built-ins.
- Update `ROADMAP.md` and relevant architecture docs as implementation progresses. Mark work complete only after merge into `develop` and required checks pass.

## Workflow

- Use a short-lived branch from the latest `develop`, named `feature/bot-coin-farmer/<task>` or `fix/bot-coin-farmer/<task>`.
- Open implementation PRs against `develop`.
- Run `pnpm --filter @coinzilla/bot-coin-farmer test`, the package coverage command, and applicable workspace checks. Verify the package scripts exist before relying on them.
- Never merge task work into `main`; only the user approves the final release PR.

## Modularity

Repository-wide pure-function extraction and file-size rules apply. Keep I/O at explicit infrastructure/bootstrap boundaries. Avoid placeholder modules: create a module when its contract, owner, tests and consuming workflow are ready.
