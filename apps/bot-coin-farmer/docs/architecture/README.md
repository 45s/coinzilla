# Coin Farmer Architecture

**Status:** Design baseline for discussion  
**Implementation status:** Not started

## Documents

- [Application architecture](./COIN_FARMER_ARCHITECTURE.md) — context, boundaries, dependency direction, logical components, workflows, safety, testing, runtime isolation, and open decisions.
- [V1-to-successor behavior plan](./V1_TO_V2_BEHAVIOR_PLAN.md) — behavior discovery, mapping, reuse policy, and parity/acceptance approach.
- [System context diagram](./diagrams/system-context.mmd)
- [Component architecture diagram](./diagrams/component-architecture.mmd)
- [Execution lifecycle diagram](./diagrams/execution-lifecycle.mmd)
- [Recovery sequence diagram](./diagrams/recovery-sequence.mmd)

## Reading order

1. Read the Coin Farmer application architecture.
2. Read the V1 strategy specification and roadmap as references, not as implementation instructions for copying V1.
3. Review the behavior mapping and identify unresolved strategy decisions.
4. Agree the contracts and implementation plan before creating application code.

## Design discipline

These documents establish the agreed separate-app direction and a proposed architecture model. They do not claim that any source modules, interfaces, state machines, persistence, or safety mechanisms already exist. Open decisions remain open until explicitly resolved.
