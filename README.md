# Chog Pool

**Deposits are never used as prizes. The track only competes with yield.**

Chog Pool is a prize-savings game on Monad. Deposit testnet USDC, bind it to
one of your Chog NFTs, and your principal stays withdrawable at any time:
you receive your shares of the pool at live value. Only realized yield goes
onto the track. For this testnet demo the pot is seeded by the team and
labelled as seeded on the yield page; deposits are never used as prizes.
Every draw, a field of Chogs races for the pot, and the winner is decided by
an on-chain draw that anyone can re-verify, by hand, from the published seed.

Built for Chogathon 2026.

## Why the Chog NFT is the game

- Your deposit is bound to a specific Chog tokenId. No Chog, no track.
- Every Chog races with its real traits and its real image, pulled live from
  the collection's own IPFS metadata. All 1,969 are the roster.
- Your mainnet Chog gets a mirror on testnet with signed provenance, and the
  UI re-checks live mainnet ownership before it ever says "Verified Holder".
- Draft Night perks, race presentation, and career records all grow out of
  your specific Chog's traits and history.

Take the NFT away and there is no deposit to bind, no roster to race, and no
identity left. The Chog is the save file, the racer, and the membership.

## How it stays honest

- **Principal-safe by design, not by guarantee.** Yield sources carry their
  own risks and the copy says so.
- **Snipe-proof odds.** Win probability comes from time-weighted average
  balances, not last-second snapshots.
- **Published seed, re-verifiable draws.** Commit-reveal with a published
  seed, and a fairness verifier that recomputes the winner step by step. The
  verifier matches the on-chain formula exactly.
- **One seed, one result, one show.** The race animation is a deterministic
  replay of the on-chain result, never a source of it.
- **Nothing mocked in production paths.** Every number comes from a contract
  read or collection metadata. Fixed APY claims are banned on principle,
  yield is variable and labeled that way.

## The experience

- **The race:** countdown, gates open, real Chog images in the lanes,
  trait-driven pace, photo finish, podium.
- **Draft Night:** pick 1-of-3 trait-derived perks before each race. Pure
  presentation and side prizes. The on-chain draw always decides the winner.
- **Spectator mode:** watch any race with no wallet. Cheer with Test $CHOG
  tips that feed the bonus pot.
- **Fairness verifier:** paste a race ID, see the winner re-derived from the
  published seed in front of you.
- **Share cards:** post-race PNGs with the real winner and the real pot.
- **Test Drive:** no Chog? Claim one clearly labeled Test Chog and use the
  full site. Test Drive and Verified Holder never blur.

## Under the hood

- **Contracts:** Solidity + Foundry on Monad testnet (chainId 10143).
  Savings pool with TWAB accounting, LP yield adapter, mirror NFT with
  EIP-712 signed provenance, commit-reveal draw engine, career store.
- **Frontend:** React 19 + TypeScript + Vite + viem. Dual-network by design:
  reads from Monad mainnet (chainId 143) for Chog data, plays on testnet.
- **Media:** Chog images and traits from the collection's own IPFS metadata,
  resolved via Pinata gateway. No invented traits, ever.
- **Addresses:** every contract address lives in one registry with a CI check
  that fails the build if a literal address appears anywhere else.

## Links

- Live demo: [chogpool.vercel.app](https://chogpool.vercel.app)
- Testing instructions and demo video live in the submission.

## License

All rights reserved until Chogathon 2026 judging concludes.
