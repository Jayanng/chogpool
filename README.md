# Chog Grand Prix

**A skill arena where your Chog is your athlete.** Enter with a stake that
stays withdrawable, play the seeded course as your Chog, and the top 3 on
the leaderboard split the pot. Every run is a tape of presses on a
published course seed, and anyone can re-run it and get the exact same
numbers. Skill you can prove.

Built for Chogathon 2026. Test funds only, Monad testnet (chainId 10143).

## The game

- Enter with a stake bound to one of your Chog NFTs. No Chog, no track,
  and the stake stays withdrawable at any time.
- Your Chog is the runner: its real image and its real traits, pulled live
  from the collection's own IPFS metadata. All 1,969 are the roster.
- One course per round, built from a published seed. Every player faces the
  identical field, and the course re-derives from the seed by hand.
- You control the run: tap or hold to jump, duck under the gates, coins sit
  on the good racing line, and close calls pay bonus points.
- One revive per run, paid in Test $CHOG. The fee feeds the round's prize,
  and the cap lands on-chain with round settlement.
- The top 3 split the pot 50/30/20, and every placement lands in your
  Chog's on-chain career record.

## Why the Chog NFT is the game

- Your entry is bound to a specific Chog tokenId. Take the NFT away and
  there is no entry to bind and no runner to play.
- The character on the course is your Chog's actual image. Traits, tier,
  and career all belong to that one token.
- Your mainnet Chog gets a mirror on testnet with signed provenance, and
  the UI re-checks live mainnet ownership before it ever says
  "Verified Holder". A Test Drive mint is labelled "Test Drive" everywhere.
- Leaderboards and careers accumulate per Chog across rounds. The Chog is
  the save file, the athlete, and the membership.

## How it stays honest

- **Stakes stay yours.** Deposits are never used as prizes. What comes back
  is your shares at live value, withdrawable at any time.
- **One course, one seed.** The course derives from a published seed: the
  same field for everyone, re-derivable by hand, never chosen at play time.
- **Runs are replayable.** Every run is a tape of presses. The Proof page
  plays the tape through the same simulation and recomputes score,
  distance, coins, and close calls. Trust the tape, not the server.
- **The pot grows from real value only.** Seeded funds and revive fees
  today, realized yield through the no-loss adapter next. Every increment
  traces to a real transaction. No projected rates, no paper accounting,
  and the pot page separates seeded from earned in plain numbers.
- **Nothing mocked.** Every number comes from a contract read, the run's
  own simulation, or collection metadata. Fixed APY claims are banned on
  principle: yield is variable and labelled that way.

## The experience

- **Set me up:** one guided path from an empty wallet to being entered:
  faucet, swap, Test $CHOG, a Test Chog minted as your runner, then the
  deposit. Every step is a real transaction you sign.
- **The Run:** the playable course. Your Chog's image, the ghost of the
  course's best run beside you, one revive, and a run record you can copy
  at the finish line.
- **The leaderboard:** placements read live from the CareerStore's on-chain
  record. A row appears only when the chain recorded it.
- **Replays:** any run's tape played back with commentary and the finish
  margin, all derived from the tape itself.
- **Proof:** paste a run record, watch every number recompute from the seed
  and the presses, in your browser.
- **The pot:** where the money comes from today and where it grows next,
  with the mechanics behind a disclosure for anyone who wants to check.

## Under the hood

- **Contracts:** Solidity + Foundry on Monad testnet (chainId 10143).
  Savings pool with time-weighted entry accounting, a frozen no-loss yield
  adapter interface, mirror NFT with EIP-712 signed provenance, career
  store, and the Test CHOG token.
- **Frontend:** React 19 + TypeScript + Vite + viem. The run is a pure,
  deterministic simulation: the same seed and the same presses always
  produce the same numbers, which is what makes replays exact and proofs
  cheap. Dual-network by design: Chog data reads from Monad mainnet
  (chainId 143), play settles on testnet.
- **Media:** Chog images and traits from the collection's own IPFS
  metadata, resolved via Pinata gateway. No invented traits, ever.
- **Addresses:** every contract address lives in one registry with a CI
  check that fails the build if a literal address appears anywhere else.

## What's next

- Rounds settle on chain: the top 3 paid by the contract itself, recorded
  to the career store at settlement.
- Yield through the no-loss adapter feeds the pot: a no-loss venue behind
  the frozen interface is the next step, and an Aave venue follows where
  Aave is live.
- Trait powers on the course: each Chog's traits become its signature move.

## Links

- Live demo: [chogpool.vercel.app](https://chogpool.vercel.app)
- Testing instructions and demo material live in the submission.

## License

All rights reserved until Chogathon 2026 judging concludes.
