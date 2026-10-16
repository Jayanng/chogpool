# CHOG POOL: TEAM RULES (binding)

1. **Nothing mocked, nothing hardcoded.** Real contracts with test value (faucet tokens, real DEX, real fees) are fine. A function that pretends (fake APY ticking up, fake yield numbers) is banned.
2. **Everything real about Chog.** Mirror NFTs carry real mainnet token IDs, real IPFS metadata, real images. The product reads real mainnet Chogs. The boost mapping is OUR design layer on real traits and is labeled as such.
3. **Zero money spent.** Testnet funds only (chain faucet stables + faucet MON). Never buy a Chog, never deposit real money, no mainnet writes before submission.
4. **Real yield only.** PuddleSwap LP fees (live testnet pools) for the demo; verified Aave V3.7 contracts for the production path (rehearsed on a local mainnet fork). Honest labels on both.
5. **Real randomness.** Commit-reveal draw, published seed, anyone can re-verify. No fake winners ever. The race animation is a deterministic visualization of the on-chain result, never a source of it.
6. **Verified facts only.** No unverified numbers in judge-facing copy (banned: "~990 holders", "34k $CHOG holders", any fixed "5.8% APY", "on-chain traits", "guaranteed no loss", "Chainlink VRF on Monad"). All contract addresses only from infra/verified.json with source + date.
7. **Honest framing everywhere.** "Testnet rehearsal, production routes to Aave." Aave smart-contract risk disclosed. No absolutes about safety.
8. **Test $CHOG allowed**: a real ERC-20 on testnet, labeled "Test CHOG" in name/symbol/UI, used only for the fun layers (cheering, rerolls, side prizes).
9. **Scope: full v3.** Time is a deadline (Oct 23, 15:00 UTC), not a constraint. Nothing is cut by default; cuts need both owners to agree and get recorded in docs/DECISIONS.md.
10. **The address rule is machine-enforced**: `node infra/check-addresses.mjs` fails CI on any 0x literal outside the registry. Fix by adding to infra/verified.json (with source), never by inline literals.

## Judge-facing copy bans (from verification)
- No "guaranteed", "risk-free", "never lose" absolutes.
- Prizes scale with the pool. Never promise prize sizes.
- Traits are off-chain IPFS metadata; say "reads the Chog's traits", never "on-chain traits".
- APY is read live and labeled "current, variable", never a hardcoded number.

## Label discipline: Verified Holder vs Test Drive (user-approved 2026-10-14)
- Two racers exist in the testnet demo: **Verified Holder** (minted with a real mainnet owner signature) and **Test Drive** (anyone, one per wallet, clearly labeled).
- The two paths are NEVER blurred: every UI surface showing a racer carries its badge; Test Chog metadata carries the "Test Chog" label; the demo video shows both paths once each.
- Test Drive is testnet-only. The production/mainnet path accepts real Chogs only. No exception.
- Framing rule: lead with the open experience ("try the full track in one click"), never with what we lack. Test Drive is a feature and a funnel (spectator → cheerer → test driver → real holder), not a workaround.
