---
"@grimoirelabs/cli": minor
"@grimoirelabs/venues": minor
---

Add a full `setup` onboarding flow for execute mode and document secure keystore usage for agent-run environments.

- add guided `grimoire setup` flow for chain/RPC/wallet onboarding with smoke preview and venue doctor checks
- support setup-managed password env reuse via `.grimoire/setup.env`, with automatic CLI autoload and `GRIMOIRE_SETUP_ENV_FILE` override
- add setup security warnings and password-safety guidance for Codex/Claude-style workflows
- document setup, keystore, and venue doctor behavior updates across README, CLI reference, tutorials, and skills
- add Polymarket venue support in `@grimoirelabs/venues` (adapter + venue CLI surface) and wire it through Grimoire venue workflows
