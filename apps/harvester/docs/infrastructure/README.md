# Harvester infrastructure documentation

- [Broker port and adapter](broker-port-and-adapter.md) — application-owned broker port, infrastructure adapter and reliability rules.
- [Binance provider-instance identity and registry](provider-instance-registry.md) — explicit Binance identity, the exchange-neutral registry contract, capability validation and lifecycle cleanup.

Infrastructure contracts must remain aligned with the actual adapter, shared broker package contracts and deterministic tests. The domain must not depend on exchange SDK details.
