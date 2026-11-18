# Harvester infrastructure documentation

- [Broker port and adapter](broker-port-and-adapter.md) — application-owned broker port, infrastructure adapter and reliability rules.
- [Provider-instance identity and registry](provider-instance-registry.md) — explicit provider/account identity, capability validation, lifecycle cleanup and route ownership.
- [Execution and market-data routing](execution-routing.md) — independent exact routes, provider provenance, no-fallback behavior and account isolation.

Infrastructure contracts must remain aligned with the actual adapter, shared broker package contracts and deterministic tests. The domain must not depend on exchange SDK details.
