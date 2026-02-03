# Grimoire Business Model: Two-Mode Strategy

This document defines a two-mode product strategy that cleanly separates adoption from production value.

## Overview

Grimoire operates in two execution modes that share the same DSL and IR:

- **Mode A - Grimoire VM Skill (In-Agent)**
  - Runs inside Claude/Codex/agent sessions.
  - Optimized for fast adoption, iteration, and distribution.
  - Best-effort execution semantics (agent interprets the VM spec).

- **Mode B - External Runtime (Deterministic)**
  - Runs via CLI or hosted service.
  - Optimized for reliability, auditability, and onchain execution.
  - Deterministic semantics from compile -> IR -> executor.

This creates a clear "draft in-agent, deploy in runtime" workflow.

## Positioning

**Mode A (VM Skill):**
- Zero-install feel inside agent environments.
- Community and education oriented.
- Great for exploration, prototyping, and sharing strategies.

**Mode B (External Runtime):**
- Production-grade guarantees.
- Full onchain adapter support.
- Stronger safety, compliance, and audit tooling.

## Business Model Split

**Free / OSS**
- DSL + compiler
- VM skill + local simulation
- Example spell library
- Community tools + skills

**Paid / Pro**
- Hosted runtime
- Managed RPC + key vault
- Policy engine + guardrails
- Observability + compliance logs
- SLA + support

## Differentiation Summary

- **Same language**: identical DSL + IR across both modes.
- **Different guarantees**: VM skill is flexible; runtime is deterministic.
- **Different markets**: hobbyists + teams exploring (Mode A) vs production teams (Mode B).

## Guardrails to Avoid Confusion

- Publish a **conformance test suite** for both modes.
- Clearly label behavior:
  - "VM mode = best-effort execution"
  - "Runtime mode = deterministic execution"
- Maintain consistent docs for syntax and semantics.

## Suggested Next Steps

- Maintain the VM spec for the skill mode and keep it aligned with the DSL/IR.
- Define a hosted runtime offering and pricing tiers.
- Build a shared conformance test suite to keep parity.
