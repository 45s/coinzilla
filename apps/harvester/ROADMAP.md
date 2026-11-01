# Harvester Roadmap

## Discovery and foundation

- [x] Initialize the app as a private Node.js ESM workspace package using the repository's pnpm and Node.js conventions.
- [~] Implement the initial trading-config loader/validator and deterministic tests (PR #395).
- [~] Establish startup bootstrap and CLI entry point with fail-fast configuration loading.
- [ ] Define the harvester's product responsibility, source systems, data contracts, and expected outputs with the product owner.
- [ ] Record security, privacy, retention, rate-limit, and operational requirements for each data source.
- [ ] Choose the smallest architecture that satisfies the agreed requirements.
- [ ] Agree on the first business use case, including source, output, business rules, and acceptance criteria.
- [ ] Implement the first business vertical slice with deterministic unit tests and explicit failure handling.
- [ ] Add integration tests for external systems, keeping them opt-in and independent of the default unit-test suite.

## Delivery rules

- Follow the repository root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md`, plus this app's `AGENTS.md`.
- Keep credentials and environment-specific values out of source control.
- Do not introduce runtime dependencies until a concrete requirement justifies them.
- Mark work complete only after implementation is merged into `develop` and required checks pass.
