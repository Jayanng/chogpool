# WORKING AGREEMENT: Jayanng + teammate

## Zones (directory ownership)
- **teammate owns:** `contracts/` (all), `web/src/money/`, `web/src/identity/`, `infra/deployments.json` (deploy outputs)
- **Jayanng owns:** `packages/ui/` (design system), `web/src/race/`, `web/src/draft/`, `web/src/design/`, `scripts/video/`
- **Shared (changes need a heads-up in chat):** `web/src/App.tsx`, `web/src/lib/`, `package.json` roots, `infra/verified.json` (both must approve any new address: source required)

## The interfaces folder is law
- `contracts/interfaces/*.sol` and any frozen TS types under `web/src/types/` are the contract between us.
- Changing any frozen interface requires BOTH approvals on the PR.
- Everything else can move freely inside your own zones.

### Shared surfaces (current)
- `web/src/types/game.ts`, the `GameSource` TS type is a frozen shared surface. It currently covers only 4 of `IChogPool`'s methods (`nextDrawAt`, `potBalance`, `depositOf`, `deposit`). **It must be extended with `twabOf`, `oddsBpsOf` and `withdrawAll` before the race and money-path work can use them**, those three are needed by the race view (odds), the deposit dashboard (time-weighted odds) and the withdraw-all action. Extending it is a shared-surface change: heads-up in chat first, both sides agree the signature matches the Solidity interface exactly, then it lands.

## Branching
- Trunk-based: `main` is always green (CI).
- Feature branches `feat/<zone>-<thing>`, lifetime ≤ 2 days, merged via PR.
- The other person's coding agent reviews first (against the team rules and the gate protocol), then a human glance.
- No long-lived parallel branches.

## The design system
- `packages/ui` is versioned (v0.x). Screens import from `@chogpool/ui`, never write raw tokens.
- Jayanng iterates on ui freely; breaking changes bump minor + a style-guide check; teammate upgrades deliberately (`pnpm --filter web up @chogpool/ui`).
- Style guide lives at `/style` route, rendered from the real tokens.

## CI / environment
- CI runs in GitHub Actions only, never on our 2-CPU VPS.
- `forge build && forge test` (contracts), `node infra/check-addresses.mjs` (registry), `pnpm run build:web` (web).
- The VPS is for: orchestration, demo video capture, local anvil fork rehearsals.
- Address rule: any new address must be added to `infra/verified.json` WITH a source + date, then `node infra/gen-addresses.mjs` regenerates the TS module. Never inline.

### Submodules are pinned, never `forge install` to "fix" a build
- **`forge install` silently rewrites the pin.** It bumps `contracts/lib/openzeppelin-contracts` from the pinned commit to the newest tag (it moved v5.6.1 → v5.7.0) and rewrites the `.gitmodules` URL. CI checks out the pinned commit, so your local tree and CI then disagree with no warning, you test one OpenZeppelin and ship another.
- **The rule:** never run `forge install` / `forge update` on this repo. If a dependency looks missing or out of date, run:
  ```
  git submodule update --init --recursive
  ```
  That materialises exactly the commits the index pins, locally and in CI alike.
- **After any dependency change, verify the pin before you commit:**
  ```
  git submodule status          # must show the pinned tags/commits
  git diff --submodule          # must be EMPTY
  cat .gitmodules               # URLs must be the canonical github.com ones
  ```
  A non-empty `git diff --submodule` means you have drifted from CI. Restore with the command above.
- Only the owner of the dependency decision bumps a pin deliberately, and that bump is its own commit so CI logs stay readable.

## Daily sync
- One async check-in message per day: what changed on shared surfaces (interfaces, verified.json, ui versions). Silence = nothing shared changed.

## Tiebreaker
- Disagreements on shared surfaces: Jayanng decides. Design final say: Jayanng. Contracts correctness final say: teammate. Factual accuracy (addresses, chain behavior): the registry + live verification, not opinions.

## Gates
- Every phase gate: shared tests green in CI + both humans confirm the integrated slice + record in docs/DECISIONS.md before the next phase starts.
- Submission: user (Jayanng) manually verifies the app + video and approves before anything is submitted (standing rule).

## Wiring an external contract address
- Any `set<X>(address)` that the contract later CALLS must validate that the target has code (`target.code.length == 0` → revert). A non-zero, codeless address compiles, deploys and passes review, then reverts mid-transaction forever. Found in `DrawEngine.setCareerStore`: the engine calls `recordRace` inside `award()`, so wiring a dead address bricked every draw with the pot already locked up, unrecoverable without an owner intervention that itself could not happen because `award()` reverts. Validate at wiring time, where the failure is cheap, never at call time, where it is not.
- Do not "fix" this by wrapping the call in a try/catch. Silently dropping the career hook hides a misconfiguration and lets draws settle with careers quietly not recorded, the exact class of invisible divergence the agreement exists to prevent.
