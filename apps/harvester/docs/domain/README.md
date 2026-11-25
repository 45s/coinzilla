# Harvester domain documentation

- [Repository test scenario catalog](../../../../docs/testing/SCENARIO_CATALOG.md) — cross-workspace human-readable behavior scenarios, inputs/outputs, subcases, implementation links, and named test mappings.
- [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md) — canonical strategy-neutral method for scenario design, lifecycle/accounting proof, fixtures, adversarial cases and evidence.

- [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md) — **sole authoritative Conservative behavior contract**.
- [Accounting invariants](ACCOUNTING_INVARIANTS.md) — implementation/regression verification matrix and current verification boundary.
- [Domain test inventory](DOMAIN_TEST_INVENTORY.md) — source-driven behavior-to-test map, test-quality findings and prioritized improvements.
- [Conservative domain scenario tests](CONSERVATIVE_DOMAIN_SCENARIO_TESTS.md) — Conservative-specific behavior examples and conceptual lifecycle model; uses the shared methodology above. Coverage status is tracked in [#1763](https://github.com/45s/coinzilla/issues/1763).
- [Domain glossary](DOMAIN_GLOSSARY.md) — domain terms and ownership boundaries.
- [Portfolio domain](portfolio.md) — Portfolio concepts, fill application and domain boundaries.
- [Conservative behavior baseline](CONSERVATIVE_BEHAVIOR_BASELINE.md) — superseded historical pointer only; never use as current rules.
- [Recovery Seller policy blocker audit](RECOVERY_SELLER_POLICY_BLOCKERS.md) — source-based CG comparison, current RS gaps, owner decisions and execution gates.

- [Recovery Seller Domain Specification](recovery-seller-domain-specification.md) — draft RS contract, legacy accounting and profitability invariants, and concurrent operation with CG.
- [Recovery Seller Runtime Flows and Source Audit](recovery-seller-runtime-flows.md) — source-verified startup/event entry points, decision flows, order/fill lifecycle schemas and current implementation gaps.
- [Recovery Seller Implementation Roadmap](recovery-seller-implementation-roadmap.md) — six phases from the CG reuse audit through concurrent integration and offline lifecycle verification.

Other documents may explain or verify behavior, but must link to the canonical specification rather than define competing strategy rules.
