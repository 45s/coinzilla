# Bitunix Spot development workflow

- Status: Required
- Type: Package development workflow
- Owner: Brokers
- Applies to: Every human contributor, AI coding agent, and automated contributor changing Bitunix Spot behavior

This document is the mandatory Bitunix-specific workflow. It supplements, and never weakens, the repository [engineering standards](../../../ENGINEERING_STANDARDS.md), [AI-agent workflow](../../../AI_AGENT_WORKFLOW.md), [structured error handling standard](../../../docs/engineering/structured-error-handling.md), and [Broker API contract](../BROKER_API.md).

## 1. Objective and architectural boundary

Implement and verify Bitunix through the **common Broker API contract and the Bitunix provider facade**. The deliverable is working provider behavior exposed through the exchange-neutral contract—not a standalone Bitunix script, a parallel API, or a diagnostic-only abstraction.

- Read [Broker API and capability contract](../BROKER_API.md) first. The common API is a structural contract; do not invent a generic `new Broker({ provider })` constructor or require inheritance from `CoreBroker` unless the actual public contract has changed.
- Use the same common method names, result/error semantics, decimal guarantees, capability declarations, and conformance expectations as other providers.
- Keep Bitunix REST/WS signing, wire DTOs, response parsing, and provider-specific normalization inside the Bitunix implementation.
- Do not make consumers inspect provider source code to decide which method to call. Use the common contract and declared capabilities.
- A provider-specific extension is allowed only when the behavior is genuinely exchange-specific, explicitly documented, and does not replace or fork a common operation.
- Unsupported or unproven behavior remains explicitly unsupported/unknown. Do not fabricate canonical data or advertise readiness because a low-level endpoint happens to respond.

## 2. Mandatory preflight for every Bitunix task

Before editing or making any state-changing action, the agent MUST:

1. Read the root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, `docs/engineering/TASK_WORKFLOWS.md`, `docs/engineering/structured-error-handling.md`, this file, `packages/brokers/AGENTS.md`, `packages/brokers/ROADMAP.md`, and the relevant section of `BROKER_API.md`.
2. Identify the owning common Broker API method/capability, Bitunix provider implementation, callers/consumers, tests, configuration, and tracking issue.
3. Follow the mandatory external-reference audit in [Brokers AGENTS.md](../AGENTS.md): inspect JKorf/Bitunix.Net first, the TypeScript reference where relevant, and official Bitunix Spot documentation. Distinguish official specification, third-party source, fixtures, and observed exchange behavior.
4. Record the exact question being resolved, verified facts, discrepancies, unknowns, safety implications, and acceptance criteria in the task issue/PR.
5. Inspect existing adapters and tests before deciding where a change belongs. Reuse the existing contract and patterns; do not add duplicate error models, capability models, transport clients, or one-off scripts.

If the task is not sufficiently understood, evidence conflicts, or a safety guarantee is missing, preserve fail-closed behavior and record the exact blocker. Do not guess.

## 3. Discovery must become implementation and regression coverage

**Collecting information is not task completion. Every actionable discovery must be evaluated for an immediate source-code, test, or contract update.**

For each relevant finding:

1. Identify the exact Broker API behavior affected.
2. Update the narrowest owning layer: request adapter, response adapter, protocol validation, provider mapping, result/mutation outcome, structured error, or capability evidence.
3. Add or update deterministic offline tests that encode the observed/documented behavior.
4. Add a sanitized fixture when a real exchange response provides useful evidence. Preserve the source, endpoint, observation date, and limitations; never turn one observation into an undocumented universal guarantee.
5. Verify both the provider-specific behavior and the common Broker API contract/conformance behavior.
6. Update the Broker API documentation, Bitunix capability evidence, README, roadmap, and issue/PR when the public behavior, support status, or blocker changes.

Do not leave useful findings only in chat, a local report, a script, a TODO, or a historical audit. Convert them into maintained source/tests/docs in the same task where practical. If no source change is justified, explain why in the issue/PR and preserve the evidence in the appropriate maintained record.

### Required scenario coverage

Add tests appropriate to the operation, including:

- valid request construction and exact decimal/quantity denomination;
- symbol status, market filters, minimum quantity/notional, price/quantity precision, and missing/unknown metadata;
- invalid inputs and unsupported combinations;
- successful and malformed response envelopes, missing fields, wrong symbols/IDs, and inconsistent data;
- exchange-declared rejections, including insufficient balance/permission, invalid symbol/quantity/price, market restrictions, and rate limits where the response contract is known;
- transport errors, timeouts, malformed JSON, authentication/signature failures, and response loss after dispatch;
- mutation outcome classification, reconciliation, and retry prohibition for unknown outcomes;
- structured error name/code/context/cause and secret redaction;
- cleanup, connection lifecycle, and callback/error isolation where applicable.

Do not invent expected exchange error codes. Derive them from official evidence or clearly labeled observations, and test unknown/unrecognized codes as well.

## 4. Testing policy — strict and unchanged

This section is intentionally strict:

- Default unit/contract/conformance tests MUST be deterministic, offline, and credential-free.
- Automated tests, CI jobs, scheduled workflows, and AI-agent-executed test commands MUST NOT place orders, cancel orders, transfer funds, withdraw, or otherwise mutate a LIVE account.
- Broker order-mutation integration tests MUST use an official TESTNET/sandbox environment. If Bitunix has no Spot TESTNET, do not redirect those tests to LIVE.
- Never add production credentials to GitHub Actions, test fixtures, source files, issue/PR text, logs, or chat.
- Never weaken these restrictions to obtain a live response or to make a test pass.
- The current Bitunix lifecycle restrictions and absence of an isolated Spot TESTNET remain tracked in [issue #1185](https://github.com/45s/coinzilla/issues/1185). This workflow does not waive or supersede that issue.

A live response observed by a human operator may inform offline tests, but the tests must replay sanitized fixtures or deterministic fakes. The live exchange must never be contacted by the test suite.

## 5. Operator-controlled local LIVE experiments are a separate activity

A human may explicitly choose to run a carefully scoped local LIVE experiment with their own credentials and personally initiate the command/action. This is an **operator-controlled production investigation**, not a test, not CI, not an agent action, and not evidence that Bitunix is production-ready.

This distinction does not weaken Section 4:

- The human operator alone decides whether to initiate the LIVE request and presses the execution button/runs the command on their own machine.
- An AI agent may inspect and improve the code, prepare a guarded local command, explain its exact effects, and analyze sanitized results supplied by the operator. **An AI agent MUST NOT execute, trigger, schedule, or autonomously repeat a LIVE mutation**, even when credentials are available in the local environment or the user has discussed a proposed experiment.
- No unattended process, test runner, CI workflow, scheduled job, remote agent, or auto-retry mechanism may trigger the experiment.
- The tool must state prominently that it targets the LIVE Bitunix Spot endpoint and show the exact provider, symbol, side, order type, price, quantity, and estimated notional before submission.
- Require an explicit, operation-specific confirmation immediately before dispatch. The operator must select the unified CLI's `--place-order` mode, review the exact displayed order and preflight caveats, then press ENTER at the final prompt; any non-empty response declines. Do not rely only on a source-code constant, an old acknowledgement, or the presence of API credentials.
- Use the least-privileged credentials possible. Keep secrets in the operator's local environment; never request them in chat or persist them in reports.
- Before a deliberately expected insufficient-balance probe, read the relevant account balances and symbol metadata through the common Broker API, display the preflight result, and require the operator to confirm the intended small order. An empty balance is not a technical guarantee that the exchange will reject the order: bonuses, transfers, other assets, account settings, or exchange behavior may change the outcome.
- Never use an experiment to test withdrawals, transfers, or cancellation unless separately and explicitly scoped and confirmed. The default order experiment must not perform any additional mutation.
- Never automatically retry a placement. If the request may have reached Bitunix but the acknowledgement is lost, classify the result as `OUTCOME_UNKNOWN`, stop, and require manual investigation. Do not submit a duplicate order.
- Capture only the minimum sanitized request/response evidence needed to improve the implementation. Redact API keys, signatures, nonces, account identifiers, personal data, and sensitive balances. Keep local diagnostic artifacts ignored by Git and protected by restrictive file permissions.
- A successful or rejected LIVE request is one observation, not a substitute for documented lifecycle guarantees, TESTNET, or a production-readiness decision.

The current fixed HYPEUSDT operator mode uses `scripts/bitunix/run-healthcheck.js --place-order`. It runs inside the existing report-branch workflow: the command requires a clean `develop` checkout and `origin`, verifies the explicit diagnostic safety/configuration prerequisites, then runs the guarded one-shot attempt. That attempt independently re-reads market metadata, symbol filters, balances and symbol-scoped open orders through the Broker API; any failed read or invalid preflight blocks confirmation and dispatch. Unrelated diagnostic failures (for example, order-history or WebSocket probes not used by this order path) remain visible in the report but do not block the guarded preflight. The report distinguishes diagnostic health from the operator preflight gate, publishes only the allowlisted sanitized outcome, and returns the checkout to `develop`. Its command and safety controls are documented in the [Brokers README](../README.md#one-shot-bitunix-hypeusdt-operator-order-attempt) and tracked in [issue #1608](https://github.com/45s/coinzilla/issues/1608). Its order parameters are fixed; any different order requires a separately reviewed task. This reference does not relax any rule above or resolve issue [#1185](https://github.com/45s/coinzilla/issues/1185).

All Bitunix CLI modes are routed through `scripts/bitunix/run-healthcheck.js`: the default publishes a sanitized read-only report, `--local` writes a local-only read-only report, and `--place-order` first requires the diagnostic safety/configuration gate, then runs the separate human-only guarded LIVE operation. The guarded operation performs its own fresh market/filter/balance/open-order preflight; optional diagnostics remain reported but are not treated as order-path prerequisites. The order outcome is added to the same allowlisted report branch, which is pushed before the checkout returns to `develop`. The default and local modes never place orders. The local operator tool is separate from the automated test suite. Do not describe its invocation as running tests or add it to `pnpm test`, CI, or a default development command.

## 6. Turning a real exchange response into durable knowledge

When an operator supplies a sanitized observation:

1. Preserve the exact endpoint, HTTP method, product (Spot, not Futures), environment (LIVE), timestamp, request shape with sensitive values removed, HTTP status, Bitunix application code/message, and response shape.
2. Label the evidence as **observed LIVE behavior**. Do not present it as an official guarantee or infer undocumented semantics from one response.
3. Compare it with the current official Spot documentation and the reference implementations. Record any discrepancy.
4. Add a minimal sanitized fixture or deterministic fake to the relevant unit tests. Do not include account-specific/private data or authentication material.
5. First add a regression test and verify the expected RED result; then update the implementation and verify GREEN, following repository TDD rules.
6. Normalize known exchange rejections into the existing Broker result/error contract. Preserve the original provider error as the cause and retain safe exchange code/message/context. Unknown codes must remain diagnosable rather than being silently mapped to success or a misleading generic error.
7. Verify request/response adapter behavior, common Broker conformance, capability status, and relevant failure branches.
8. Update maintained documentation and the issue/PR with the observation's provenance and limitations.

### Error-handling expectations

- Distinguish local validation failures, authentication/signature failures, exchange business rejections, rate limits, transport failures, malformed responses, and uncertain mutation outcomes.
- Preserve the original cause when wrapping at a meaningful boundary, using the repository structured-error standard.
- Use stable machine-readable error codes; do not parse human-readable messages as the primary control flow.
- Keep retryability explicit and conservative. A definitive exchange rejection is not the same as a transport timeout after dispatch.
- Never classify an unknown placement outcome as a definitive rejection. Never retry an uncertain order placement.
- Do not store entire request/response graphs in errors. Include bounded, safe context only.
- Do not leak secrets or private account data through error messages, logs, fixtures, snapshots, or CI artifacts.

## 7. Completion criteria

A Bitunix capability task is complete only when all applicable items are satisfied:

- [ ] The common Broker API contract is preserved and the Bitunix provider implementation is used through it.
- [ ] Official documentation and required reference implementations were inspected and evidence is recorded.
- [ ] Request construction and response adaptation are validated against the evidence.
- [ ] Known errors/rejections and unknown/malformed responses have explicit, tested handling.
- [ ] Structured errors preserve stable codes, safe context, and original causes.
- [ ] Deterministic offline regression/conformance tests cover the discovered behavior.
- [ ] No automated test or AI agent performs a LIVE mutation.
- [ ] Capability status and limitations accurately reflect the evidence.
- [ ] README, Broker API contract, roadmap, issue/PR, and relevant agent instructions are synchronized.
- [ ] Required package tests, coverage, lint, policy checks, and applicable CI pass on the exact PR head.
- [ ] The task issue/PR records exact evidence, test commands/results, unresolved blockers, and documentation impact.

A local LIVE observation alone never satisfies the acceptance criteria for lifecycle completeness, safe reconciliation, TESTNET acceptance, or production readiness.
