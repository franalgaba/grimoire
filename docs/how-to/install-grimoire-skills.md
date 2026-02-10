# How To Install Grimoire Skills

Use this guide to install Grimoire skills so agents can immediately work with spells, CLI workflows, and venue snapshot commands.

## Outcome

After this guide, your agent environment has Grimoire skills installed from this repository.

## 1. Install From The Repository

Run:

```bash
npx skills add https://github.com/franalgaba/grimoire
```

This installs the skills published in this repository, including:

- `grimoire`
- `grimoire-aave`
- `grimoire-uniswap`
- `grimoire-morpho-blue`
- `grimoire-hyperliquid`

## 2. Use In Claude Code

In Claude Code:

1. Open the project terminal.
2. Run:

```bash
npx skills add https://github.com/franalgaba/grimoire
```

3. Start a new Claude Code session (or restart the current one) so newly installed skills are loaded.
4. Prompt with a task that should trigger the skill, for example:
   - `Validate and simulate spells/compute-only.spell using Grimoire.`

## 3. Update Skills Later

Re-run the same install command to pick up repository updates:

```bash
npx skills add https://github.com/franalgaba/grimoire
```
