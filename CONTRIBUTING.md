# Contributing to Grimoire

Thanks for wanting to contribute! This guide exists to save both of us time.

## The One Rule

**You must understand your code.** If you can't explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. You can gain understanding by interrogating an agent with access to the codebase until you grasp all edge cases and effects of your changes. What's not fine is submitting agent-generated slop without that understanding.

If you use an agent, run it from the repository root so it picks up `AGENTS.md` automatically. Your agent must follow the rules and guidelines in `AGENTS.md`.

## First-Time Contributors

We use an approval gate for new contributors:

1. Open an issue describing what you want to change and why
2. Keep it concise (if it doesn't fit on one screen, it's too long)
3. Write in your own voice, at least for the intro
4. A maintainer will comment `lgtm` if approved
5. Once approved, you can submit PRs

This exists because AI makes it trivial to generate plausible-looking but low-quality contributions. The issue step lets us filter early.

## Before Submitting a PR

```bash
bun run validate
```

If you touched adapters, the runtime, or spell behavior:

```bash
./scripts/run-onchain-tests.sh --dry-run
```

If you edited skills:

```bash
bunx skills-ref validate skills/grimoire-vm
```

For user-facing changes, add a changeset:

```bash
bunx changeset
```

Do not bump versions manually. Changesets handle versioning after the initial 0.1.0 release.

## Philosophy

Grimoire’s core stays lean. Protocol SDKs and heavyweight integrations belong in `@grimoirelabs/venues` or external tooling, not the compiler/runtime.

## Questions?

Open an issue with your question and context.
