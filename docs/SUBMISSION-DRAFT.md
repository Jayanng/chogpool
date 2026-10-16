# Chog Pool, submission draft

Working draft for the Chogathon 2026 submission form. Everything here is a
verified claim or clearly marked as to fill in. Nothing invented, nothing
overpromised. Character budget for the form is 8,000, this draft sits around
3,000 so there is room for polish.

---

## Project

**Chog Pool** (The Chog Track)
Team: Johnson Enyenihi (design and frontend) and teammate (contracts, money path).
Handles: [to fill in, X and Discord]

## What we built

A prize-savings game where your Chog NFT races for the yield, and your
deposit never leaves your pocket.

You deposit testnet USDC and bind it to one of your Chogs. Your principal
stays withdrawable in full, any time, no locks. Only the yield your deposit
earns goes onto the track. Every draw, a field of Chogs races for the pot,
and the winner is decided by an on-chain draw anyone can re-verify.

The pitch in one line: your dollars never enter the race. The track only
competes with yield.

Under the hood it is real throughout. Deposits go to a real yield source on
Monad testnet. Win odds come from time-weighted average balances, so nobody
can snipe a draw with a last-second deposit. Draws use commit-reveal with a
published seed, and our fairness verifier page recomputes the winner from
that seed step by step and shows you the math. Same seed, same result, same
race animation, every time.

## Why Chog matters

The Chog NFT is not decoration, it is the core of everything.

- Your deposit is bound to a specific Chog tokenId. No Chog, no track.
- Each Chog races with its real traits and real image from the collection's
  own metadata. The whole field of 1,969 is the roster.
- Ownership is verified the honest way: your mainnet Chog gets a mirror on
  testnet with signed provenance, and the UI re-checks live mainnet ownership
  before showing any "Verified Holder" label.
- The race show, Draft Night perks, and career records all hang off traits
  and history of your specific Chog.

Remove the Chog NFT and there is no deposit to bind, no roster to race, no
identity, no game. It is the save file, the racer, and the membership card at
once.

## Show it working

- Live demo: [chogpool.vercel.app, final URL to confirm]
- Demo video (3 minutes): [to fill in]
- Testing instructions: [to fill in, final form depends on contract state at
  submission]

## Under the hood

- Repo: [private until submission, link to confirm]
- Stack: Solidity (Foundry) on Monad testnet (chainId 10143), React 19 +
  TypeScript + Vite + viem frontend, on-chain read layer for Monad mainnet
  Chog data (chainId 143), IPFS metadata via Pinata gateway.
- Contracts: a savings pool with TWAB odds, an LP yield adapter, a mirror
  NFT with EIP-712 signed provenance, a commit-reveal draw engine, and a
  career store for race records.
- Pre-existing work used: OpenZeppelin and forge-std as libraries. The Chog
  Genesis collection and $CHOG token are ecosystem assets we integrate with,
  we did not deploy them.

## What we would do next

Mainnet path via Aave for real yield (audited adapter already sketched),
deeper $CHOG integration, more show layers per race, and public draw history.

---

## Honesty checklist for the final version

- Every number on the site matches a contract read or collection metadata.
- No fixed APY claims anywhere. Yield is variable and labeled as such.
- "Principal-safe by design, not by guarantee" stays in the copy. Yield
  sources carry their own risks.
- Test Drive Chogs stay clearly labeled and never blur into verified holders.
- The video must show real, working, fixture-free flows wherever the demo
  claims live functionality.
