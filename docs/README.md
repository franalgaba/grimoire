# Documentation

This repository uses the [Diataxis](https://diataxis.fr/) documentation framework.

## Structure

```
docs/
  tutorials/   # Learning-oriented, step-by-step lessons
  how-to/      # Task-oriented guides to solve specific problems
  reference/   # Factual technical descriptions (commands, flags, specs)
  explanation/ # Conceptual background, design rationale, and tradeoffs
```

## How To Place Content

- Put onboarding learning journeys in `docs/tutorials/`.
- Put practical procedures in `docs/how-to/`.
- Put precise behavior and interface details in `docs/reference/`.
- Put architecture and "why" content in `docs/explanation/`.

## Navigation

### Tutorials

- `docs/tutorials/quickstart-users-and-agents.md` (start here)
- `docs/tutorials/first-spell.md`
- `docs/tutorials/preview-to-commit.md`

### How-to Guides

- `docs/how-to/install-grimoire-skills.md`
- `docs/how-to/simulate-on-anvil-fork.md`
- `docs/how-to/use-wallet-commands-end-to-end.md`
- `docs/how-to/run-tests.md`
- `docs/how-to/bridge-with-across.md`
- `docs/how-to/use-advisory-decisions.md`
- `docs/how-to/use-state-persistence.md`
- `docs/how-to/publish.md`

### Reference

- `docs/reference/cli.md`
- `docs/reference/spell-syntax.md`
- `docs/reference/grimoire-dsl-spec.md`
- `docs/reference/compiler-runtime.md`
- `docs/reference/venues.md`
- `docs/reference/state-persistence.md`

### Explanation

- `docs/explanation/mental-model.md` (start here)
- `docs/explanation/architecture.md`
- `docs/explanation/preview-commit-model.md`
- `docs/explanation/advisory-decision-flow.md`
- `docs/explanation/type-system.md`
- `docs/explanation/data-provenance-and-replay.md`

### Agent Skills

For agent execution/playbooks, use:

- `skills/grimoire/SKILL.md`
- `skills/grimoire-aave/SKILL.md`
- `skills/grimoire-uniswap/SKILL.md`
- `skills/grimoire-morpho-blue/SKILL.md`
- `skills/grimoire-across/SKILL.md`
- `skills/grimoire-hyperliquid/SKILL.md`
- `skills/grimoire-pendle/SKILL.md`
- `skills/grimoire-polymarket/SKILL.md`

## Writing Rules

- Keep tutorials progressive and beginner-friendly.
- Keep how-to guides short, goal-first, and copy/paste-able.
- Keep reference pages complete, neutral, and easy to scan.
- Keep explanation pages focused on mental models and decisions.
