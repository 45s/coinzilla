# Application ports

Ports describe capabilities required by application workflows. Keep their contracts CEX-neutral and validate concrete implementations at the composition boundary.

The initial runtime shell defines only the EventBus and Journal contracts because their shared-package APIs have been inspected and are used by the bootstrap lifecycle.

The broker contract is intentionally deferred to CF-030. Do not invent broker method signatures before auditing the actual public `@coinzilla/brokers` API, canonical entities and required execution-history guarantees. State repository, notification publisher and clock ports are introduced alongside the workflows that first consume them.

No trading workflow or broker connection is part of the current runtime shell.
