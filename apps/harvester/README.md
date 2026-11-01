# Harvester

Harvester is a private Node.js application workspace in the Coinzilla pnpm monorepo.

## Package

- Package: `@coinzilla/harvester`
- Runtime: Node.js `>=22.23.4`
- Modules: native ECMAScript modules
- Dependencies: none yet; add only when an agreed requirement needs them

## Development

Run commands from the repository root:

```sh
pnpm --filter @coinzilla/harvester test
pnpm --filter @coinzilla/harvester test:coverage
```

The package is initialized, but its product responsibility and runtime behavior have not yet been specified. Do not invent data sources, scraping behavior, persistence, or external integrations; agree those contracts before implementation.

## Engineering guidance

AI coding agents working in this directory must follow [AGENTS.md](./AGENTS.md), [ROADMAP.md](./ROADMAP.md), and all applicable repository-level engineering guidance.
