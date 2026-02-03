# AGENTS

Repository notes for automated assistants.

## Quick orientation
- DSL spec: `docs/reference/grimoire-dsl-spec.md`
- CLI usage: `docs/reference/cli.md`
- Skills (Agent Skills format): `skills/*/SKILL.md`
- Spells: `spells/` and `@spells/`

## Common workflows
- Unit tests: `bun test`
- Full validation: `bun run validate`
- Onchain test suite: `./scripts/run-onchain-tests.sh` (use `--dry-run` to build txs only)

## Advisory + skills
- Advisors can reference external skills for tool metadata.
- Pass directories via `--advisor-skills-dir` (simulate/cast). Each skill is a folder containing `SKILL.md`.
- Advisory execution currently uses fallback values only; tooling metadata is emitted in ledger events.

## DSL reminders
- Constraints use the `with` clause (e.g., `with max_slippage=50`).
- `atomic` supports `revert` (default), `skip`, and `halt` modes.
- `import "path"` is parsed but currently ignored by the compiler (reserved for external preprocessors).
