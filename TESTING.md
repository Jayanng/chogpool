# TESTING.md

How to verify this project yourself, and what each check actually proves.

The rule this document follows: a check that cannot fail is not a check, and a
number nobody controls is not evidence. Everything below either runs against the
real chain or says plainly that it does not.

---

## 1. Prerequisites

```bash
# Foundry (the repo pins v1.8.5 in CI)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Submodules are pinned, never `forge install` or `forge update`
git submodule update --init --recursive

# Node for the web app and the infra gates
corepack enable pnpm
```

Addresses come from `infra/verified.json` at runtime. There is no `.env`, no
private key, and no RPC override in the repository. Every address in the source
is generated from that registry, see gate 5 below.

---

## 2. Contract tests

### Unit suite (no network)

```bash
cd contracts
forge test
```

147 tests. Runs in a few seconds, needs no RPC, and covers:

- **DrawEngine**, commit/reveal/finalize, the reveal window, frozen ticket
  snapshots, and the stale-boost rejection.
- **ChogPool**, deposit/withdraw accounting, TWAB ring buffer against a closed
  form, odds derivation, and the `totalPrincipal` / `lifetimePrincipal` split.
- **ChogMirror**: EIP-712 signature verification, the URI-bound message, supply
  limits, and the Test Drive restrictions.
- **CareerStore**, **TestChogToken**, career progression and the faucet cooldown.
- **Mocks**, the lossless and lossy yield venues used to pin adapter semantics.

### Fork suite (real Monad testnet)

```bash
cd contracts
forge test --match-contract 'Fork' --rpc-url monad_testnet -vvv
```

16 tests, all executed against the **live** testnet contracts, the real
PuddleSwap pair, the real router, the real StableFaucet:

- `PuddleLpAdapter.fork.t.sol` (12): LP position value against real reserves,
  harvest moving only realized value, partial and full redemption.
- `MoneyPathFork.t.sol` (4), the exact funding sequence the UI drives:
  claim → swap → approve → deposit, then withdraw.

The fork suites skip cleanly when the RPC is unreachable, so a plain
`forge test` never fails for a network reason.

**What the fork suite proves that the unit suite cannot:** that the funding path
is real. The pool's asset is PuddleSwap core USDC and is *not mintable*, the
only honest way in is `StableFaucet.claim()` followed by a real swap through the
real router. The test executes that and asserts the amounts that actually moved.

---

## 3. The gates

Four scripts, all run by CI. Run them locally with:

```bash
node infra/check-addresses.mjs   # no hardcoded addresses outside the registry
node infra/check-fixtures.mjs    # production bundle is fixture-free
node infra/gen-addresses.mjs     # regenerate the web address module
```

- **check-addresses**, fails if any `0x{40}` literal appears in source outside
  the allowlisted registry and evidence logs. This is what stops an address from
  drifting out of `infra/verified.json`.
- **check-fixtures**, the production build must not contain fixture code, and
  every fixture source must carry the sentinel the checker scans for. This is
  what stops a simulated value from ever reaching a production bundle.
- **gen-addresses**, regenerates `web/src/generated/addresses.gen.ts` from
  `infra/verified.json` + `infra/deployments.json`, and refuses to run if the
  deployment's chainId disagrees with the registry.

---

## 4. The web app

```bash
cd web
pnpm build          # tsc --noEmit && vite build
pnpm preview        # serve the production build
```

The build is type-checked, and the fixture gate (3 above) runs against the built
bundle. Pages:

| Route | What it does |
|---|---|
| `/` | Landing, reads `nextDrawAt` and the pot live |
| `/mint` | Mirror mint: real mainnet lookup, URI-bound signature |
| `/deposit` | Funding path: claim → swap → approve → deposit → withdraw |
| `/yield` | Real LP position value and harvest into the pot |
| `/tips` | Test CHOG faucet and tips |
| `/race`, `/verify`, `/draft`, `/spectator` | Phase 3 surfaces |
| `/style` | Design tokens (team tool, not user-facing) |

---

## 5. Verifying a mirror token with no trust in us

This is the check the mirror mint exists to make possible. It needs nothing from
our frontend.

```bash
# The stored URI, realURIOf(), NOT tokenURI()
cast call <MIRROR> 'realURIOf(uint256)(string)' <TOKEN_ID> --rpc-url https://testnet-rpc.monad.xyz

# The digest recorded at mint
cast call <MIRROR> 'uriHashOf(uint256)(bytes32)' <TOKEN_ID> --rpc-url https://testnet-rpc.monad.xyz

# Whether the token went through the signed path
cast call <MIRROR> 'isTestDrive(uint256)(bool)' <TOKEN_ID> --rpc-url https://testnet-rpc.monad.xyz
```

Then, independently:

```bash
# keccak256 of the stored URI's raw bytes
cast keccak "$(cast call <MIRROR> 'realURIOf(uint256)(string)' <TOKEN_ID> --rpc-url https://testnet-rpc.monad.xyz | tr -d '"')"
```

If the two hashes match, the metadata on chain is the metadata the mainnet owner
signed. If `isTestDrive` is true, nobody signed anything, the hash match then
proves only that the stored bytes hash to the recorded value, and the token says
so on-chain.

**Hash `realURIOf()`, not `tokenURI()`.** `tokenURI()` prepends a `test-chog:`
display prefix to Test Drive tokens, and that prefix was never part of the signed
bytes, so hashing `tokenURI()` reports a false negative for exactly the tokens
that carry no signature. This was a real bug in the first version of this
document: the check it described could never pass for a Test Drive mint. It is
pinned by `test_VerificationCheck_HashesTheRealURI_NotTheDisplayedOne`.

The `/verify` page runs exactly this and shows the comparison.
The recorded on-chain result is kept in `docs/MIRROR-VERIFY-LOG.md` alongside
the Gate evidence logs, for the same reason they are: it quotes the real values
the check produced, which is the only thing that makes it evidence rather than
a claim. `check-addresses` allows that file for exactly that reason.


---

## 6. Live deployment

Current stack (Monad testnet, chainId 10143):

| Contract | Address |
|---|---|
The current stack is stack v5. Read the addresses from
`infra/deployments.json` (generated into `web/src/generated/addresses.gen.ts`),
or from the registry in `infra/verified.json`. They are deliberately not
duplicated here: `check-addresses` fails on any `0x{40}` literal outside the
registry and the evidence logs, and a doc that quotes them goes stale the
moment the stack is redeployed. The recorded live readings for this stack are
in `docs/MIRROR-VERIFY-LOG.md`.

Read directly from the explorer: `https://testnet.monadscan.com/address/<address>`

### Draws are manual

There is no keeper and no schedule. `finalize()` clears `nextDrawAt`, so a
`0` reading is the truthful state, no draw is scheduled. Draws are opened by
the operator, on demand. Nothing in the UI promises a cadence.

---

## 7. What is deliberately not tested

- **Aave.** Aave V3 is the production yield path on Monad mainnet and is not
  deployed on Monad testnet. The `/yield` page says so and touches nothing on
  mainnet. The testnet yield path is the real PuddleSwap LP adapter behind the
  same frozen `IYieldAdapter` interface.
- **The mainnet Chog collection** is read, never written. Lookups are real
  `ownerOf` / `tokenURI` calls plus real IPFS metadata fetches.
- **Withdrawal amounts are not bit-identical to deposits.** The position is real
  liquidity in a real AMM, so redemption value moves with trading. The fork test
  asserts the returned value stays within impermanent-loss bounds rather than
  asserting an exact figure that would be false.
