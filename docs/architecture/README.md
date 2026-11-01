# Coinzilla Architecture

This directory records cross-cutting architecture principles and decisions for the Coinzilla workspace.

## Start here

- [Coinzilla architecture blueprint](./COINZILLA_ARCHITECTURE.md) — shared package ownership, dependency direction, exact financial contracts, adapter boundaries, safety, and testing principles.
- [ADR-0001: Clean and Hexagonal Architecture](./decisions/ADR-0001-clean-hexagonal-architecture.md) — the accepted architectural style.
- [ADR-0002: Coin Farmer as an independent successor application](./decisions/ADR-0002-coin-farmer-successor-app.md) — the decision to preserve V1 and build the successor separately.
- [Coin Farmer application architecture](../../apps/bot-coin-farmer/docs/architecture/README.md) — the concrete design for the new application.

## Authority and change policy

- [Free-Roll V1 strategy specification](../../apps/bot-free-roll/README.md) remains the reference for the currently documented Free-Roll behavior.
- [Free-Roll V1 engineering roadmap](../../apps/bot-free-roll/ROADMAP.md) remains the reference for V1's engineering invariants and backlog. This architecture initiative does not edit or take ownership of that roadmap.
- Coin Farmer's architecture and future implementation decisions belong under [apps/bot-coin-farmer](../../apps/bot-coin-farmer/README.md).
- Repository-wide engineering standards and the AI-agent workflow remain mandatory.
- This cross-cutting blueprint does not silently approve changes to trading policy, package ownership, or public APIs.
- If documents conflict, stop and identify the conflict rather than resolving it by assumption.
- Record material architectural changes as new ADRs; preserve the historical decision record.

## Status

- Clean/Hexagonal architecture direction: accepted as a structural approach.
- Separate successor application: accepted; see ADR-0002.
- Coin Farmer detailed design: documented as a proposal for further discussion.
- Coin Farmer implementation: not started or authorized by this documentation PR.
