#!/usr/bin/env bash
# Withdraw the full redeemable value of a position from the LIVE ChogPool,
# reading the amount at send time so a stale figure can never revert it.
#
# WHY THIS EXISTS. `positionValue()` is a live reading of the pair, so it moves
# with trading. Hardcoding a number captured minutes ago risks sending an amount
# the venue can no longer pay, which reverts with InsufficientLiquidity and wastes
# gas. Reading it in the same breath as the send removes that whole failure mode.
#
# WHY THIS IS A SHELL SCRIPT AND NOT A forge SCRIPT. The caller must be the
# DEPOSITOR, not the pool owner. A forge script broadcasts from a single key (the
# deployer's), so it cannot sign as the depositor. `cast send` takes the depositor's
# key directly, which is exactly the access this action needs.
#
# USAGE:
#   export RACER_PRIVATE_KEY=0x...      # the depositor's key, never a literal
#   ./contracts/script/withdraw-full.sh [TOKEN_ID]
#
# The key is read from the environment and never written to disk, never appears in
# argv (so it is not in `ps` output or shell history), and is never echoed.
#
# ADDRESS DISCIPLINE: no address literals. Everything is read from
# infra/deployments.json and infra/verified.json, the same registry the rest of the
# repo enforces via infra/check-addresses.mjs.

set -euo pipefail

TOKEN_ID="${1:-954}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEP="$ROOT/infra/deployments.json"
REG="$ROOT/infra/verified.json"

if [[ ! -f "$DEP" || ! -f "$REG" ]]; then
  echo "withdraw-full: registry files not found (expected $DEP and $REG)" >&2
  exit 1
fi

# The RPC comes from the registry too, so this script cannot drift onto a different
# network than the one the registry describes.
RPC="$(node -e "console.log(require('$REG').monadTestnet.rpc)")"
POOL="$(node -e "console.log(require('$DEP').pool)")"
ADAPTER="$(node -e "console.log(require('$DEP').yieldAdapter)")"
USDC="$(node -e "console.log(require('$REG').monadTestnet.puddleUSDC.address)")"

if [[ -z "${RACER_PRIVATE_KEY:-}" ]]; then
  echo "withdraw-full: set RACER_PRIVATE_KEY (the depositor's key) in the environment." >&2
  echo "  export RACER_PRIVATE_KEY=0x... && ./contracts/script/withdraw-full.sh $TOKEN_ID" >&2
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "withdraw-full: 'cast' not found. Install Foundry (foundryup)." >&2
  exit 1
fi

# Derive the signer from the key so the script can confirm it is the depositor
# BEFORE sending anything. A mismatch here means the wrong key is loaded, and
# catching it up front is the difference between a clean abort and a reverted tx.
SIGNER="$(cast wallet address "$RACER_PRIVATE_KEY")"
DEPOSITOR="$(cast call "$POOL" "depositOf(uint256)(address,uint256,uint256)" "$TOKEN_ID" \
  --rpc-url "$RPC" | head -1 | awk '{print $1}')"

echo "token            : $TOKEN_ID"
echo "pool             : $POOL"
echo "adapter          : $ADAPTER"
echo "signer           : $SIGNER"
echo "depositor onchain: $DEPOSITOR"

if [[ "${SIGNER,,}" != "${DEPOSITOR,,}" ]]; then
  echo "" >&2
  echo "withdraw-full: REFUSING TO SEND. The loaded key is not the depositor." >&2
  echo "  ChogPool.withdraw accepts the depositor OR the owner, and this key is" >&2
  echo "  neither. Load the depositor's key, or run this as the pool owner." >&2
  exit 1
fi

# Read the amount at send time. This is the whole point of the script.
AMOUNT="$(cast call "$ADAPTER" "positionValue()(uint256)" --rpc-url "$RPC" | awk '{print $1}')"
SHARES="$(cast call "$POOL" "sharesOf(uint256)(uint256)" "$TOKEN_ID" --rpc-url "$RPC" | awk '{print $1}')"

if [[ "$AMOUNT" == "0" ]]; then
  echo "withdraw-full: the venue reports 0 value, nothing to withdraw." >&2
  exit 1
fi

HUMAN_AMOUNT="$(cast --to-unit "$AMOUNT" 2>/dev/null || echo "$AMOUNT")"
HUMAN_SHARES="$(cast --to-unit "$SHARES" 2>/dev/null || echo "$SHARES")"

echo ""
echo "withdrawing the FULL redeemable value:"
echo "  amount          : $AMOUNT ($HUMAN_AMOUNT USDC)"
echo "  shares held     : $SHARES ($HUMAN_SHARES)"
if [[ "$SHARES" -gt "$AMOUNT" ]]; then
  STRANDED=$((SHARES - AMOUNT))
  HUMAN_STRANDED="$(cast --to-unit "$STRANDED" 2>/dev/null || echo "$STRANDED")"
  echo "  stranded residue: $STRANDED ($HUMAN_STRANDED USDC) — the documented entry cost"
  echo "                     plus pair drift. It reverts on any withdrawal attempt."
fi
echo ""

# Simulate first. A simulation is free; a reverted send is not. If the call reverts
# here, nothing is broadcast and the reason is printed.
if ! cast call "$POOL" "withdraw(uint256,uint256)" "$TOKEN_ID" "$AMOUNT" \
     --rpc-url "$RPC" --from "$SIGNER" >/dev/null 2>&1; then
  echo "withdraw-full: simulation reverted, nothing was sent." >&2
  echo "  The venue can no longer pay this amount. Re-run to read a fresh value." >&2
  exit 1
fi

echo "simulation passed, sending..."

cast send "$POOL" "withdraw(uint256,uint256)" "$TOKEN_ID" "$AMOUNT" \
  --rpc-url "$RPC" \
  --private-key "$RACER_PRIVATE_KEY"

echo ""
echo "=== after ==="
echo "shares held      : $(cast call "$POOL" "sharesOf(uint256)(uint256)" "$TOKEN_ID" --rpc-url "$RPC")"
echo "venue value      : $(cast call "$ADAPTER" "positionValue()(uint256)" --rpc-url "$RPC")"
echo "withdrawer USDC  : $(cast call "$USDC" "balanceOf(address)(uint256)" "$SIGNER" --rpc-url "$RPC")"
