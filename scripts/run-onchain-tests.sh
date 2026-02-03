#!/usr/bin/env bash
# ============================================================================
# Grimoire Onchain Test Suite
# Validates spell syntax features end-to-end
#
# Features tested:
#   - Guards section           — spell-level invariants
#   - Action constraints       — `with slippage=50, deadline=300, ...`
#   - Output binding           — `result = venue.method(args)`
#   - onFailure mode           — `atomic skip:` / `atomic halt:`
#   - Imports with alias       — `import "path" as alias`
#   - Typed params + units     — `type: amount`, `1.5 USDC`, `50 bps`
#   - Advisory output schemas  — object/array schemas
#   - Condition/event triggers — `on condition ... every`, `on event ... where`
#   - Skill auto-select        — action venue uses skill name
#
# Budget (per spell, USDC 6-decimals):
#   Feature tests:
#   - Swap spells:    100000 raw = 0.1 USDC each  (× 6 = 0.6 USDC)
#   - Deposit spells: 100000 raw = 0.1 USDC each  (× 3 = 0.3 USDC)
#   Venue tests (chained — deposit/withdraw pairs are net-zero):
#   - Uniswap V3:  USDC→ETH 0.1 + ETH→USDC 0.0001 ETH  (~0.1 USDC net)
#   - Uniswap V4:  USDC→ETH 0.1 USDC                     (~0.1 USDC net)
#   - Aave V3:     deposit 0.1 + withdraw 0.1              (~0 net)
#   - Morpho Blue: deposit 0.1 + withdraw 0.1              (~0 net)
#   - Total USDC:     ~1.1 USDC + slippage
#   - Total ETH:      ~0.003 ETH + gas
#   - Gas on Base:    ~$0.01 total
#
# Wallet requirements:
#   - Keystore: ~/.grimoire/keystore.json (or KEYSTORE env var)
#   - ETH:  >= 0.01 ETH on Base
#   - USDC: >= 5 USDC
#
# Usage:
#   # Simulate only (no gas, no wallet needed):
#   ./scripts/run-onchain-tests.sh
#
#   # Dry-run (builds txs, estimates gas, does NOT send):
#   ./scripts/run-onchain-tests.sh --dry-run
#   # (prompts for keystore password, or set KEYSTORE_PASSWORD env var)
#
#   # Live execution on Base (recommended — cheap gas):
#   CHAIN=8453 ./scripts/run-onchain-tests.sh --execute
#
#   # Live execution on mainnet:
#   CHAIN=1 ./scripts/run-onchain-tests.sh --execute
#
#   # Skip password prompt via env var:
#   KEYSTORE_PASSWORD=... ./scripts/run-onchain-tests.sh --execute
#
#   # Custom keystore path or RPC:
#   KEYSTORE=~/my-keystore.json RPC_URL=https://... ./scripts/run-onchain-tests.sh --execute
#
#   # Resume from a specific phase (e.g., after a failure in Phase 4):
#   ./scripts/run-onchain-tests.sh --execute --start-phase 4
#
#   # Recovery mode — only return stranded funds to Base:
#   ./scripts/run-onchain-tests.sh --recover
# ============================================================================

set -euo pipefail
shopt -s nullglob

# ── Configuration ────────────────────────────────────────────────────────────

CHAIN="${CHAIN:-8453}"                     # Default: Base (cheap gas)
RPC_URL="${RPC_URL:-}"                     # Empty = use built-in default for chain
ARB_RPC_URL="${ARB_RPC_URL:-}"            # Arbitrum RPC for multi-chain tests
KEYSTORE="${KEYSTORE:-$HOME/.grimoire/keystore.json}"
CLI="bun packages/cli/src/index.ts"
STATE_DIR=".grimoire/test-suite"
CHECKPOINT_FILE="$STATE_DIR/checkpoint"
SPELLS_DIRS=("spells" "@spells")

# ── Argument Parsing ─────────────────────────────────────────────────────────

MODE=""
START_PHASE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--execute|--recover)
      MODE="$1"
      shift
      ;;
    --start-phase)
      START_PHASE="${2:-0}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
SKIP=0
TOTAL=0

# ── Spell Lists ──────────────────────────────────────────────────────────────

# Phase 1: Pure computation spells that pass in simulate mode (no state deps)
SIMULATE_SPELLS=(
  spells/test-guards.spell
  spells/test-complex-expressions.spell
  spells/test-conditional.spell
  spells/test-elif-chain.spell
  spells/test-halt.spell
  spells/test-limits.spell
  spells/test-logical-ops.spell
  spells/test-modulo.spell
  spells/test-nested-conditional.spell
  spells/test-percentage.spell
  spells/test-ternary.spell
  spells/test-builtin-functions.spell
  spells/test-loop-index.spell
  spells/test-repeat-loop.spell
  spells/test-until-loop.spell
  spells/test-try-catch-retry.spell
  spells/test-parallel.spell
  spells/test-pipeline.spell
  spells/test-advise-output.spell
  spells/test-advise-schema-object-array.spell
  spells/test-blocks-imports.spell
  spells/test-import-alias.spell
  spells/test-typed-params-assets.spell
  spells/test-trigger-condition-event.spell
  spells/test-ephemeral-state.spell
  spells/test-state-counter.spell
)

# Phase 2: New feature spells — simulated first, then cast onchain
# These test the 4 new syntax features through the full pipeline.
#
# Spells without output binding pass in simulate mode.
# Spells WITH output binding (result = venue.method(...)) only fully work
# in --execute mode because the action must actually run to produce output.
CAST_SPELLS_SIMULATE_OK=(
  # AI advisory condition
  spells/test-ai-judgment.spell

  # Skills + auto-select venue
  spells/test-using-skill-autoselect.spell
  spells/test-skill-autoselect-implicit.spell

  # Feature 1: Guards (guards + swap — guard checking works in simulate)
  spells/test-guards-complex.spell

  # Feature 2: Constraints (swap + with clause — action built correctly)
  spells/test-constraints.spell
  spells/test-constraint-single.spell
  spells/test-constraints-extended.spell

  # Feature 4: onFailure (atomic blocks with failure mode)
  spells/test-atomic-onfailure.spell
  spells/test-atomic-halt.spell
  spells/test-atomic-revert.spell
)

# Feature 3: Output binding — these require --execute to pass because
# `result` is only populated when the action is executed by the wallet.
CAST_SPELLS_EXECUTE_ONLY=(
  spells/test-output-binding.spell
  spells/test-output-binding-constraints.spell
  spells/test-output-binding-conditional.spell
)

# All cast spells combined
CAST_SPELLS=("${CAST_SPELLS_SIMULATE_OK[@]}" "${CAST_SPELLS_EXECUTE_ONLY[@]}")

# Phase 4: Venue adapter tests — ordered so funds chain between them.
# Deposit/withdraw pairs are net-zero. Swaps lose a bit to slippage.
VENUE_SPELLS=(
  # Uniswap V3 (swap pair)
  spells/test-v3-usdc-to-eth.spell         # 0.1 USDC → ETH
  spells/test-v3-eth-to-usdc.spell         # 0.0001 ETH → USDC

  # Uniswap V4 (Permit2 flow)
  spells/test-v4-usdc-to-eth.spell         # 0.1 USDC → ETH

  # Aave V3 (deposit + withdraw = net zero)
  spells/test-aave-deposit.spell           # deposit 0.1 USDC
  spells/test-aave-withdraw.spell          # withdraw 0.1 USDC

  # Morpho Blue (deposit + withdraw = net zero)
  spells/test-morpho-lend.spell            # deposit 0.1 USDC
  spells/test-morpho-withdraw.spell        # withdraw 0.1 USDC
)

# Phase 5: Multi-chain venue tests (Arbitrum + Hyperliquid)
# Only runs in --execute mode (bridges don't work in dry-run/simulate)
MULTICHAIN_SPELLS=(
  # Part A: Arbitrum round-trip
  spells/test-across-weth-base-to-arb.spell       # Bridge WETH Base → Arb (gas)
  spells/test-across-usdc-base-to-arb.spell       # Bridge USDC Base → Arb
  spells/test-v3-arb-usdc-to-eth.spell            # Swap on Arbitrum
  spells/test-across-usdc-arb-to-base.spell       # Bridge USDC Arb → Base

  # Part B: Hyperliquid (HyperCore)
  spells/test-across-usdc-base-to-hypercore.spell # Bridge USDC Base → HyperCore
  spells/test-hyperliquid-spot-small.spell        # Spot trade
  spells/test-hyperliquid-long-small.spell        # Long perp
  spells/test-hyperliquid-short-small.spell       # Short perp
  spells/test-across-usdc-arb-to-base-final.spell # Bridge USDC Arb → Base (final)
)

# All spells in spells/@spells folders for validation
VALIDATION_SPELLS=()
for dir in "${SPELLS_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    VALIDATION_SPELLS+=("$dir"/*.spell)
  fi
done

# ── Helper Functions ─────────────────────────────────────────────────────────

log_header() {
  echo ""
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
}

log_phase() {
  echo ""
  echo -e "${BOLD}── $1 ──${NC}"
  echo ""
}

run_spell() {
  local spell="$1"
  local command="$2"
  local expect_fail="${3:-}"   # "expect_fail" = spell is supposed to fail
  local spell_name
  spell_name=$(basename "$spell" .spell)

  TOTAL=$((TOTAL + 1))
  printf "  %-45s" "$spell_name"

  # Capture output and exit code
  local output
  local exit_code=0
  output=$(eval "$command" 2>&1) || exit_code=$?

  if [[ "$expect_fail" == "expect_fail" ]]; then
    # Negative test: failure is the correct behavior
    if [ $exit_code -ne 0 ]; then
      echo -e "${GREEN}PASS (expected fail)${NC}"
      PASS=$((PASS + 1))
    else
      echo -e "${RED}FAIL (expected fail but succeeded)${NC}"
      FAIL=$((FAIL + 1))
    fi
  elif [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC}"
    FAIL=$((FAIL + 1))
    # Show first few lines of error
    echo "$output" | grep -i -m3 "error\|fail\|Error" | while read -r line; do
      echo -e "    ${DIM}${line}${NC}"
    done
  fi
}

# Write a checkpoint so Phase 5 can be resumed after failure
checkpoint() {
  mkdir -p "$(dirname "$CHECKPOINT_FILE")"
  echo "$1" > "$CHECKPOINT_FILE"
}

# Check if a Phase 5 sub-step was already completed (for --start-phase 5 resume)
past_checkpoint() {
  local step="$1"
  if [ ! -f "$CHECKPOINT_FILE" ]; then
    return 1  # No checkpoint file → haven't passed anything
  fi
  local saved
  saved=$(cat "$CHECKPOINT_FILE")

  # Ordered list of Phase 5 sub-steps
  local -a steps=(
    "phase5-wrap-eth"
    "phase5-bridge-weth"
    "phase5-bridge-usdc"
    "phase5-wait-bridges"
    "phase5-unwrap-weth"
    "phase5-swap-arb"
    "phase5-bridge-usdc-arb-to-base"
    "phase5-bridge-usdc-hypercore"
    "phase5-wait-hypercore"
    "phase5-hl-spot"
    "phase5-hl-long"
    "phase5-hl-short"
    "phase5-hl-withdraw"
    "phase5-wait-hl-withdraw"
    "phase5-bridge-final"
  )

  local saved_idx=-1
  local step_idx=-1
  for i in "${!steps[@]}"; do
    [[ "${steps[$i]}" == "$saved" ]] && saved_idx=$i
    [[ "${steps[$i]}" == "$step" ]]  && step_idx=$i
  done

  # Step is "past" the checkpoint if its index <= saved index
  [[ $step_idx -le $saved_idx ]]
}

# Wait for ERC20 balance to appear on a destination chain (bridge completion)
wait_for_bridge() {
  local asset_address=$1  # ERC20 contract address
  local min_balance=$2    # Minimum balance in raw units
  local chain=$3          # Destination chain ID
  local rpc_url=$4        # RPC URL for destination chain
  local timeout=1200      # 20 minutes
  local interval=30       # Poll every 30 seconds
  local elapsed=0

  if [ -z "$rpc_url" ]; then
    echo -e "    ${RED}No RPC URL for chain ${chain} — skipping bridge wait${NC}"
    return 1
  fi

  while [ $elapsed -lt $timeout ]; do
    local balance
    balance=$(bun -e "
      import { createPublicClient, http, erc20Abi } from 'viem';
      import { createWalletFromConfig, loadPrivateKey } from '@grimoirelabs/core';
      import { readFileSync } from 'node:fs';
      import { privateKeyToAccount } from 'viem/accounts';

      const keystoreJson = readFileSync('${KEYSTORE}', 'utf-8');
      const keyConfig = { type: 'keystore', source: keystoreJson, password: process.env.KEYSTORE_PASSWORD };
      const rawKey = loadPrivateKey(keyConfig);
      const account = privateKeyToAccount(rawKey);

      const client = createPublicClient({ transport: http('${rpc_url}') });
      const bal = await client.readContract({
        address: '${asset_address}',
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      console.log(bal.toString());
    " 2>/dev/null) || balance="0"

    if [ "${balance:-0}" -ge "$min_balance" ] 2>/dev/null; then
      echo -e "    ${GREEN}Bridge complete — balance: ${balance}${NC}"
      return 0
    fi

    echo -e "    ${DIM}Balance: ${balance:-0} / ${min_balance} — waiting ${interval}s (${elapsed}s elapsed)${NC}"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  echo -e "    ${RED}Timeout waiting for bridge (${timeout}s)${NC}"
  return 1
}

# ── Preflight Checks ─────────────────────────────────────────────────────────

log_header "Grimoire Onchain Test Suite"

echo ""
echo -e "  ${DIM}Chain:${NC}     $CHAIN"
echo -e "  ${DIM}RPC:${NC}       ${RPC_URL:-<default for chain>}"
echo -e "  ${DIM}Arb RPC:${NC}   ${ARB_RPC_URL:-<default for chain>}"
echo -e "  ${DIM}Mode:${NC}      ${MODE:-simulate}"
if [ "$START_PHASE" -gt 0 ]; then
  echo -e "  ${DIM}Start:${NC}     Phase $START_PHASE"
fi
echo -e "  ${DIM}Keystore:${NC}  $KEYSTORE"
echo -e "  ${DIM}State:${NC}     $STATE_DIR"

# For --dry-run, --execute, and --recover, we need a keystore + password
if [[ "$MODE" == "--dry-run" || "$MODE" == "--execute" || "$MODE" == "--recover" ]]; then
  # Verify keystore exists
  if [ ! -f "$KEYSTORE" ]; then
    echo ""
    echo -e "${RED}Error: Keystore not found at ${KEYSTORE}${NC}"
    echo -e "${DIM}  Generate one:  grimoire wallet generate${NC}"
    echo -e "${DIM}  Or specify:    KEYSTORE=/path/to/keystore.json $0 $MODE${NC}"
    exit 1
  fi

  # Resolve RPC URL: env var or interactive prompt
  if [ -z "${RPC_URL:-}" ]; then
    echo ""
    read -rp "Base RPC URL (leave empty for default): " RPC_URL
  fi

  # Resolve Arbitrum RPC URL for multi-chain tests
  if [ -z "${ARB_RPC_URL:-}" ]; then
    echo ""
    read -rp "Arbitrum RPC URL (leave empty for default): " ARB_RPC_URL
  fi

  # Resolve password: env var or interactive prompt
  if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
    echo ""
    read -rsp "Keystore password: " KEYSTORE_PASSWORD
    echo ""
    if [ -z "$KEYSTORE_PASSWORD" ]; then
      echo -e "${RED}Error: Password cannot be empty${NC}"
      exit 1
    fi
  fi
  export KEYSTORE_PASSWORD

  if [[ "$MODE" == "--execute" ]]; then
    echo ""
    echo -e "${YELLOW}WARNING: Live execution mode — real transactions will be sent!${NC}"
    echo -e "${DIM}  Budget: ~1.2 USDC + ~0.002 ETH (gas on Base + Arbitrum)${NC}"
    echo ""
    read -rp "Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
fi

# ── Recovery Mode ────────────────────────────────────────────────────────────

if [[ "$MODE" == "--recover" ]]; then
  log_phase "Recovery: Return Stranded Funds to Base"

  CAST_FLAGS="--chain $CHAIN --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
  if [ -n "$RPC_URL" ]; then CAST_FLAGS="$CAST_FLAGS --rpc-url $RPC_URL"; fi

  ARB_CAST_FLAGS="--chain 42161 --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
  if [ -n "$ARB_RPC_URL" ]; then ARB_CAST_FLAGS="$ARB_CAST_FLAGS --rpc-url $ARB_RPC_URL"; fi

  USDC_ARB="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

  # Step 1: Try to withdraw from Hyperliquid if funds are there
  echo -e "  ${DIM}Attempting Hyperliquid withdrawal...${NC}"
  HL_CLI="bun packages/venues/src/cli/hyperliquid.ts"
  run_spell "(hypercore-withdraw)" \
    "$HL_CLI withdraw --amount max --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD" || true

  # Step 2: Wait for any USDC to arrive on Arbitrum
  echo -e "  ${DIM}Checking Arbitrum USDC balance...${NC}"
  sleep 10

  # Step 3: Bridge any USDC on Arbitrum back to Base
  echo -e "  ${DIM}Bridge USDC Arbitrum → Base${NC}"
  run_spell "spells/test-across-usdc-arb-to-base-final.spell" \
    "$CLI cast spells/test-across-usdc-arb-to-base-final.spell $ARB_CAST_FLAGS" || true

  echo ""
  echo -e "${GREEN}Recovery complete. Check your Base wallet for returned funds.${NC}"
  exit 0
fi

# ── Phase 0: Compile All Spells ──────────────────────────────────────────────

if [ "$START_PHASE" -le 0 ]; then
  log_phase "Phase 0: Validate All Spells"

  validate_fail=0
  for spell in "${VALIDATION_SPELLS[@]}"; do
    if [ ! -f "$spell" ]; then
      continue
    fi
    spell_name=$(basename "$spell" .spell)
    printf "  %-45s" "$spell_name"
    output=$($CLI validate "$spell" 2>&1) || {
      echo -e "${RED}FAIL${NC}"
      echo -e "    ${DIM}${output}${NC}"
      validate_fail=$((validate_fail + 1))
      continue
    }
    echo -e "${GREEN}OK${NC}"
  done

  if [ $validate_fail -gt 0 ]; then
    echo ""
    echo -e "${RED}$validate_fail spell(s) failed validation. Aborting.${NC}"
    exit 1
  fi
  echo ""
  echo -e "${GREEN}All spells validated successfully.${NC}"

  log_phase "Phase 0: Compile All Spells"

  compile_fail=0
  for spell in "${SIMULATE_SPELLS[@]}" "${CAST_SPELLS[@]}" "${VENUE_SPELLS[@]}" "${MULTICHAIN_SPELLS[@]}"; do
    if [ ! -f "$spell" ]; then
      continue
    fi
    spell_name=$(basename "$spell" .spell)
    printf "  %-45s" "$spell_name"
    output=$(bun -e "
      import { compileFile } from './packages/core/src/compiler/index.ts';
      const r = await compileFile('$spell');
      if (!r.success) { console.error(JSON.stringify(r.errors)); process.exit(1); }
    " 2>&1) || {
      echo -e "${RED}FAIL${NC}"
      echo -e "    ${DIM}${output}${NC}"
      compile_fail=$((compile_fail + 1))
      continue
    }
    echo -e "${GREEN}OK${NC}"
  done

  if [ $compile_fail -gt 0 ]; then
    echo ""
    echo -e "${RED}$compile_fail spell(s) failed to compile. Aborting.${NC}"
    exit 1
  fi
  echo ""
  echo -e "${GREEN}All spells compiled successfully.${NC}"
fi

# ── Phase 1: Simulate Pure-Computation Spells ────────────────────────────────

if [ "$START_PHASE" -le 1 ]; then
  log_phase "Phase 1: Simulate Pure-Computation Spells (no gas)"

  for spell in "${SIMULATE_SPELLS[@]}"; do
    if [ ! -f "$spell" ]; then
      SKIP=$((SKIP + 1))
      continue
    fi
    run_spell "$spell" \
      "$CLI simulate $spell --chain $CHAIN --no-state"
  done
fi

# ── Phase 2: Simulate Feature Spells (no wallet needed) ─────────────────────

if [ "$START_PHASE" -le 2 ]; then
  log_phase "Phase 2: Simulate Feature Spells (guards, constraints, onFailure)"

  for spell in "${CAST_SPELLS_SIMULATE_OK[@]}"; do
    if [ ! -f "$spell" ]; then
      SKIP=$((SKIP + 1))
      continue
    fi
    run_spell "$spell" \
      "$CLI simulate $spell --chain $CHAIN --no-state"
  done

  # Note about output binding spells
  echo ""
  echo -e "  ${DIM}(output binding spells skipped in simulate — need --execute)${NC}"
fi

# ── Phase 3: Cast Onchain (dry-run or live) ──────────────────────────────────

if [[ ("$MODE" == "--dry-run" || "$MODE" == "--execute") && "$START_PHASE" -le 3 ]]; then
  # Build common flags
  CAST_FLAGS="--chain $CHAIN --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
  if [ -n "$RPC_URL" ]; then
    CAST_FLAGS="$CAST_FLAGS --rpc-url $RPC_URL"
  fi
  if [[ "$MODE" == "--dry-run" ]]; then
    CAST_FLAGS="$CAST_FLAGS --dry-run"
  fi

  phase_label="Cast (dry-run)"
  [[ "$MODE" == "--execute" ]] && phase_label="Cast (LIVE)"

  log_phase "Phase 3: $phase_label — All Feature Spells"

  echo -e "  ${DIM}Feature 1: Guards${NC}"
  run_spell "spells/test-guards-complex.spell" \
    "$CLI cast spells/test-guards-complex.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Feature 2: Action Constraints${NC}"
  run_spell "spells/test-constraints.spell" \
    "$CLI cast spells/test-constraints.spell $CAST_FLAGS"
  run_spell "spells/test-constraint-single.spell" \
    "$CLI cast spells/test-constraint-single.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Feature 3: Output Binding${NC}"
  run_spell "spells/test-output-binding.spell" \
    "$CLI cast spells/test-output-binding.spell $CAST_FLAGS"
  run_spell "spells/test-output-binding-constraints.spell" \
    "$CLI cast spells/test-output-binding-constraints.spell $CAST_FLAGS"
  run_spell "spells/test-output-binding-conditional.spell" \
    "$CLI cast spells/test-output-binding-conditional.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Feature 4: Atomic onFailure${NC}"
  run_spell "spells/test-atomic-onfailure.spell" \
    "$CLI cast spells/test-atomic-onfailure.spell $CAST_FLAGS"
  run_spell "spells/test-atomic-halt.spell" \
    "$CLI cast spells/test-atomic-halt.spell $CAST_FLAGS"
  run_spell "spells/test-atomic-revert.spell" \
    "$CLI cast spells/test-atomic-revert.spell $CAST_FLAGS"
fi

# ── Phase 4: Venue Adapter Tests (dry-run or live) ────────────────────────────

if [[ ("$MODE" == "--dry-run" || "$MODE" == "--execute") && "$START_PHASE" -le 4 ]]; then
  # Ensure CAST_FLAGS are set (in case we skipped Phase 3)
  if [ -z "${CAST_FLAGS:-}" ]; then
    CAST_FLAGS="--chain $CHAIN --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
    if [ -n "$RPC_URL" ]; then CAST_FLAGS="$CAST_FLAGS --rpc-url $RPC_URL"; fi
    if [[ "$MODE" == "--dry-run" ]]; then CAST_FLAGS="$CAST_FLAGS --dry-run"; fi
  fi

  phase_label="Cast (dry-run)"
  [[ "$MODE" == "--execute" ]] && phase_label="Cast (LIVE)"

  log_phase "Phase 4: $phase_label — Venue Adapters"

  echo -e "  ${DIM}Uniswap V3${NC}"
  run_spell "spells/test-v3-usdc-to-eth.spell" \
    "$CLI cast spells/test-v3-usdc-to-eth.spell $CAST_FLAGS"
  run_spell "spells/test-v3-eth-to-usdc.spell" \
    "$CLI cast spells/test-v3-eth-to-usdc.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Uniswap V4${NC}"
  run_spell "spells/test-v4-usdc-to-eth.spell" \
    "$CLI cast spells/test-v4-usdc-to-eth.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Aave V3 (deposit + withdraw)${NC}"
  run_spell "spells/test-aave-deposit.spell" \
    "$CLI cast spells/test-aave-deposit.spell $CAST_FLAGS"
  run_spell "spells/test-aave-withdraw.spell" \
    "$CLI cast spells/test-aave-withdraw.spell $CAST_FLAGS"

  echo ""
  echo -e "  ${DIM}Morpho Blue (deposit + withdraw)${NC}"
  run_spell "spells/test-morpho-lend.spell" \
    "$CLI cast spells/test-morpho-lend.spell $CAST_FLAGS"
  run_spell "spells/test-morpho-withdraw.spell" \
    "$CLI cast spells/test-morpho-withdraw.spell $CAST_FLAGS"
fi

# ── Phase 5: Multi-Chain Venue Tests (execute only) ──────────────────────────

if [[ "$MODE" == "--execute" && "$START_PHASE" -le 5 ]]; then
  # Skip Phase 5 if earlier phases had failures (prevents stranding funds)
  if [ "$FAIL" -gt 0 ] && [ "$START_PHASE" -lt 5 ]; then
    echo ""
    echo -e "  ${YELLOW}Skipping Phase 5 — $FAIL failure(s) in earlier phases.${NC}"
    echo -e "  ${DIM}Fix failures first, then run: $0 --execute --start-phase 5${NC}"
  else
  log_phase "Phase 5: Cast (LIVE) — Multi-Chain Venue Tests"

  # Ensure CAST_FLAGS are set (in case we skipped earlier phases)
  if [ -z "${CAST_FLAGS:-}" ]; then
    CAST_FLAGS="--chain $CHAIN --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
    if [ -n "$RPC_URL" ]; then CAST_FLAGS="$CAST_FLAGS --rpc-url $RPC_URL"; fi
  fi

  ARB_CAST_FLAGS="--chain 42161 --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"
  if [ -n "$ARB_RPC_URL" ]; then ARB_CAST_FLAGS="$ARB_CAST_FLAGS --rpc-url $ARB_RPC_URL"; fi

  HL_FLAGS="--chain 999 --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD --skip-confirm --no-state"

  WALLET_FLAGS="--keystore $KEYSTORE --password-env KEYSTORE_PASSWORD"
  if [ -n "$RPC_URL" ]; then WALLET_FLAGS="$WALLET_FLAGS --rpc-url $RPC_URL"; fi

  USDC_ARB="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

  # ─── Part A: Arbitrum Round-Trip ───

  echo -e "  ${BOLD}Part A: Arbitrum Round-Trip${NC}"
  echo ""

  # Step 1: Wrap ETH → WETH on Base (for bridging)
  if ! past_checkpoint "phase5-wrap-eth"; then
    echo -e "  ${DIM}Wrap ETH → WETH on Base${NC}"
    run_spell "(wrap-eth-base)" \
      "$CLI wallet wrap --amount 0.002 --chain $CHAIN $WALLET_FLAGS"
    checkpoint "phase5-wrap-eth"
  fi

  # Step 2: Bridge WETH Base → Arbitrum (for gas)
  if ! past_checkpoint "phase5-bridge-weth"; then
    echo -e "  ${DIM}Bridge WETH Base → Arbitrum (gas)${NC}"
    run_spell "spells/test-across-weth-base-to-arb.spell" \
      "$CLI cast spells/test-across-weth-base-to-arb.spell $CAST_FLAGS"
    checkpoint "phase5-bridge-weth"
  fi

  # Step 3: Bridge USDC Base → Arbitrum
  if ! past_checkpoint "phase5-bridge-usdc"; then
    echo -e "  ${DIM}Bridge USDC Base → Arbitrum${NC}"
    run_spell "spells/test-across-usdc-base-to-arb.spell" \
      "$CLI cast spells/test-across-usdc-base-to-arb.spell $CAST_FLAGS"
    checkpoint "phase5-bridge-usdc"
  fi

  # Step 4: Wait for bridges to complete on Arbitrum
  if ! past_checkpoint "phase5-wait-bridges"; then
    echo ""
    echo -e "  ${YELLOW}Waiting for bridges to complete on Arbitrum...${NC}"
    wait_for_bridge "$USDC_ARB" 800000 42161 "${ARB_RPC_URL:-https://arb1.arbitrum.io/rpc}"
    checkpoint "phase5-wait-bridges"
  fi

  # Step 5: Unwrap WETH → ETH on Arbitrum (for gas)
  if ! past_checkpoint "phase5-unwrap-weth"; then
    echo -e "  ${DIM}Unwrap WETH → ETH on Arbitrum (gas)${NC}"
    UNWRAP_FLAGS="--keystore $KEYSTORE --password-env KEYSTORE_PASSWORD"
    if [ -n "$ARB_RPC_URL" ]; then UNWRAP_FLAGS="$UNWRAP_FLAGS --rpc-url $ARB_RPC_URL"; fi
    run_spell "(unwrap-weth-arb)" \
      "$CLI wallet unwrap --amount 0.003 --chain 42161 $UNWRAP_FLAGS"
    checkpoint "phase5-unwrap-weth"
  fi

  # Step 6: Uniswap V3 swap on Arbitrum
  if ! past_checkpoint "phase5-swap-arb"; then
    echo ""
    echo -e "  ${DIM}Uniswap V3 on Arbitrum${NC}"
    run_spell "spells/test-v3-arb-usdc-to-eth.spell" \
      "$CLI cast spells/test-v3-arb-usdc-to-eth.spell $ARB_CAST_FLAGS"
    checkpoint "phase5-swap-arb"
  fi

  # Step 7: Bridge USDC Arbitrum → Base
  if ! past_checkpoint "phase5-bridge-usdc-arb-to-base"; then
    echo ""
    echo -e "  ${DIM}Bridge USDC Arbitrum → Base${NC}"
    run_spell "spells/test-across-usdc-arb-to-base.spell" \
      "$CLI cast spells/test-across-usdc-arb-to-base.spell $ARB_CAST_FLAGS"
    checkpoint "phase5-bridge-usdc-arb-to-base"
  fi

  # ─── Part B: Hyperliquid (HyperCore) ───

  echo ""
  echo -e "  ${BOLD}Part B: Hyperliquid (HyperCore)${NC}"
  echo ""

  # Step 8: Bridge USDC Base → HyperCore (direct via Across, chainId 1337)
  if ! past_checkpoint "phase5-bridge-usdc-hypercore"; then
    echo -e "  ${DIM}Bridge USDC Base → HyperCore${NC}"
    run_spell "spells/test-across-usdc-base-to-hypercore.spell" \
      "$CLI cast spells/test-across-usdc-base-to-hypercore.spell $CAST_FLAGS"
    checkpoint "phase5-bridge-usdc-hypercore"
  fi

  # Step 9: Wait for USDC on HyperCore
  if ! past_checkpoint "phase5-wait-hypercore"; then
    echo -e "  ${YELLOW}Waiting for USDC to arrive on HyperCore (~15s)...${NC}"
    sleep 15
    checkpoint "phase5-wait-hypercore"
  fi

  # Step 10: Hyperliquid trades (offchain API — no gas needed)
  if ! past_checkpoint "phase5-hl-spot"; then
    echo ""
    echo -e "  ${DIM}Hyperliquid spot trade${NC}"
    run_spell "spells/test-hyperliquid-spot-small.spell" \
      "$CLI cast spells/test-hyperliquid-spot-small.spell $HL_FLAGS"
    checkpoint "phase5-hl-spot"
  fi

  if ! past_checkpoint "phase5-hl-long"; then
    echo -e "  ${DIM}Hyperliquid long perp${NC}"
    run_spell "spells/test-hyperliquid-long-small.spell" \
      "$CLI cast spells/test-hyperliquid-long-small.spell $HL_FLAGS"
    checkpoint "phase5-hl-long"
  fi

  if ! past_checkpoint "phase5-hl-short"; then
    echo -e "  ${DIM}Hyperliquid short perp${NC}"
    run_spell "spells/test-hyperliquid-short-small.spell" \
      "$CLI cast spells/test-hyperliquid-short-small.spell $HL_FLAGS"
    checkpoint "phase5-hl-short"
  fi

  # Step 11: Withdraw USDC from HyperCore → Arbitrum (native bridge)
  if ! past_checkpoint "phase5-hl-withdraw"; then
    echo ""
    echo -e "  ${DIM}Withdraw USDC HyperCore → Arbitrum${NC}"
    HL_CLI="bun packages/venues/src/cli/hyperliquid.ts"
    run_spell "(hypercore-withdraw)" \
      "$HL_CLI withdraw --amount 0.4 --keystore $KEYSTORE --password-env KEYSTORE_PASSWORD"
    checkpoint "phase5-hl-withdraw"
  fi

  # Step 12: Wait for withdrawal (~3-4 min)
  if ! past_checkpoint "phase5-wait-hl-withdraw"; then
    echo -e "  ${YELLOW}Waiting for HyperCore withdrawal to Arbitrum (~4 min)...${NC}"
    wait_for_bridge "$USDC_ARB" 300000 42161 "${ARB_RPC_URL:-https://arb1.arbitrum.io/rpc}"
    checkpoint "phase5-wait-hl-withdraw"
  fi

  # Step 13: Bridge USDC Arbitrum → Base (final return)
  if ! past_checkpoint "phase5-bridge-final"; then
    echo ""
    echo -e "  ${DIM}Bridge USDC Arbitrum → Base (final return)${NC}"
    run_spell "spells/test-across-usdc-arb-to-base-final.spell" \
      "$CLI cast spells/test-across-usdc-arb-to-base-final.spell $ARB_CAST_FLAGS"
    checkpoint "phase5-bridge-final"
  fi

  # Clear checkpoint on successful Phase 5 completion
  rm -f "$CHECKPOINT_FILE"
  fi  # end of failure gate
fi

# ── Summary ──────────────────────────────────────────────────────────────────

log_header "Test Results"

echo ""
echo -e "  ${GREEN}Pass:${NC}    $PASS"
echo -e "  ${RED}Fail:${NC}    $FAIL"
if [ $SKIP -gt 0 ]; then
  echo -e "  ${YELLOW}Skip:${NC}    $SKIP"
fi
echo -e "  ${DIM}Total:${NC}   $TOTAL"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
else
  echo -e "${GREEN}All $PASS tests passed.${NC}"
fi
