# Grimoire Documentation

This documentation follows the [Diátaxis](https://diataxis.fr/) framework. If you're new, start with the execution mode you want to use.

## Start here

Grimoire uses the same spell syntax in both environments. The differences are guarantees and tooling.

- VM mode (in-agent, best-effort): run spells inside an agent session with snapshot data and no adapters. For quick protocol prototyping, use venue CLI snapshots. Start with [Getting started](tutorials/getting-started.md#vm-mode-in-agent) and [Run spells in VM mode](how-to/run-grimoire-vm.md).
- Deterministic runtime (CLI): compile, simulate, and cast with adapters and state persistence. Start with [Getting started](tutorials/getting-started.md#deterministic-runtime-cli) and [Run spells with the CLI](how-to/cli-cast.md).

If you want the full comparison, see [Execution modes](explanation/execution-modes.md).

Advisory steps (`**...**` and `advise`) call Pi when a model is configured (spell model, CLI model/provider, or Pi defaults). If no model is available, the runtime uses the spell fallback. See [CLI reference](reference/cli.md) and [Pi advisory execution spec](reference/pi-advisory-spec.md).

Suggested flow: explore in VM → record advisory in CLI simulate → replay deterministically in cast. See [Run spells with the CLI](how-to/cli-cast.md).

If you are contributing to the repo, see [CONTRIBUTING.md](../CONTRIBUTING.md) and [Run tests and checks](how-to/run-tests.md).

## Updating (user view)

- Update the CLI: `npm i -g @grimoirelabs/cli@latest`
- Use `npx` for latest without install: `npx -y @grimoirelabs/cli@latest <command>`
- Update packages in your project: `npm i @grimoirelabs/core@latest @grimoirelabs/venues@latest`
- Update the VM skill: re-install with `npx skills add https://github.com/franalgaba/grimoire` (or copy `skills/grimoire-vm` into your agent skills directory again)

## Tutorials

Step-by-step guides for newcomers.

- [Getting started (choose a mode)](tutorials/getting-started.md)
- [Write your first spell](tutorials/first-spell.md)
- [Execute a spell with venues](tutorials/execute-with-venues.md)

## How-to guides

Task-focused recipes.

- [Run spells with the CLI](how-to/cli-cast.md)
- [Run spells in VM mode](how-to/run-grimoire-vm.md)
- [VM quickstart (snapshot-driven)](how-to/vm-quickstart.md)
- [Transition to deterministic execution](how-to/transition-to-deterministic.md)
- [Configure slippage and constraints](how-to/configure-slippage.md)
- [Bridge with Across](how-to/bridge-with-across.md)
- [Add and organize spells](how-to/add-spells.md)
- [Add a new venue adapter](how-to/add-venue-adapter.md)
- [Build spells programmatically](how-to/build-spells-programmatically.md)
- [Run tests and checks](how-to/run-tests.md)
- [Publish packages](how-to/publish.md)
- [DefiHack multi-track spec](how-to/defihack-multitrack-spec.md)

## Reference

Authoritative specifications.

- [Spell syntax reference](reference/spell-syntax.md)
- [Grimoire DSL spec](reference/grimoire-dsl-spec.md)
- [Core API reference](reference/core-api.md)
- [Venues package reference](reference/venues.md)
- [CLI reference](reference/cli.md)
- [IR schema reference](reference/ir.md)
- [Action constraints reference](reference/action-constraints.md)
- [Grimoire VM spec](reference/grimoire-vm.md)
- [Grimoire VM conformance](reference/grimoire-vm-conformance.md)
- [Pi advisory execution spec](reference/pi-advisory-spec.md)

## Explanation

Background and design rationale.

- [System architecture](explanation/architecture.md)
- [Compiler pipeline](explanation/compiler-pipeline.md)
- [Venue adapter model](explanation/venue-adapters.md)
- [Approval and multi-tx flows](explanation/approval-flows.md)
- [Execution modes](explanation/execution-modes.md)
- [Business model modes](explanation/business-model-modes.md)
- [Grimoire extensions spec (draft)](explanation/grimoire-extensions-spec.md)
