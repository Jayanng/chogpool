// The fairness verifier's evidence builder.
//
// Given a race id it reads the deployed contracts, recomputes the result with
// the exact DrawEngine formula (lib/derive.ts), and returns a step-by-step
// report. Every step carries its real inputs and outputs so the page can show
// the derivation, not just a verdict. A mismatch is reported loudly and
// exactly: this module never smooths over a disagreement with the chain.

import type { Address, Hex } from "viem";
import { testnetReadClient } from "../lib/wallet";
import { drawEngineAbi, poolAbi } from "../lib/abi";
import { DEPLOYED } from "../generated/addresses.gen";
import {
  commitHashOf,
  cumulativeWalk,
  deriveWinners,
  finalRandomnessOf,
  type DerivedWinner,
  type RacerTickets,
  type WalkRow,
} from "../lib/derive";
import {
  checkMirrorUriHash,
  readCareer,
  readDrawEvents,
  readMirrorBadge,
  type CareerRecord,
} from "../lib/draw";
import { getRaceSource } from "../lib/game";
import { readChog } from "../lib/chog";
import {
  VERDICT_CROSS_MISMATCH_LINE,
  VERDICT_INCOMPLETE_LINE,
  verdictCoreMismatchLine,
  verdictVerifiedLine,
  verifyCareerTitle,
  verifyMatchTitle,
  verifyPrizeLine,
  verifyRecordTitle,
  verifyRecordedWinnersLine,
  verifyWinnersLine,
} from "../lib/result-copy";
import type { DrawRecord, RaceRecordedLine } from "../types/race";
import { formatAsset, formatTickets, hexIsNonZero, shortHex } from "../lib/format";

export type CheckStatus = "pass" | "fail" | "info" | "unavailable";

export type Check = {
  key: string;
  title: string;
  status: CheckStatus;
  lines: string[];
  /** Card footer; defaults to the status's usual provenance line. */
  footer?: string;
};

export type MirrorUriCheck = {
  tokenId: bigint;
  badgeLabel: string;
  storedUri: string;
  /** The bytes actually hashed: the stored URI with any Test Drive label stripped. */
  hashedUri: string;
  recordedHash: Hex | null;
  computedHash: Hex;
  hashMatch: boolean | null;
  mainnetUri: string | null;
  mainnetMatch: boolean | null;
  metadataName: string | null;
};

export type Verification = {
  draw: DrawRecord;
  checks: Check[];
  walk: WalkRow[];
  steps: DerivedWinner[];
  racerTable: RacerTickets[];
  verdict: "verified" | "mismatch" | "incomplete";
  verdictLine: string;
};

export async function buildVerification(drawId: bigint): Promise<Verification> {
  const source = getRaceSource();
  const draw = source ? await source.getDraw(drawId) : null;
  if (!draw) throw new Error(`Race ${drawId.toString()} is not recorded on chain.`);
  const live = source?.kind === "live";

  const checks: Check[] = [];
  // A rehearsal draw exists only in this record: every wording choice below
  // drops the on-chain voice for it and keeps it for real draws.
  const rehearsal = draw.rehearsal === true;

  // ---- 1. what the chain records -------------------------------------
  checks.push({
    key: "record",
    title: verifyRecordTitle(rehearsal),
    status: "info",
    lines: [
      draw.sourceNote ??
        (live
          ? "Source: the deployed contracts (live reads)."
          : "Source: a recorded draw from the first real testnet run, used in this dev build so the derivation can be walked before the live stack has draws of its own."),
      `Draw state: ${draw.state}`,
      `Commit window closed at: unix ${draw.closeAt}`,
      `Operator commit: ${draw.commitHash}`,
      `Published seed: ${draw.seed}`,
      `Reveal block: ${draw.revealBlock.toString()}`,
      `Final randomness: ${draw.finalRandomness}`,
      `Frozen tickets: ${formatTickets(draw.totalTickets)} across ${draw.racers.length} racer(s)`,
      verifyWinnersLine(draw.winners, rehearsal),
      verifyPrizeLine(formatAsset(draw.potPerWinner), rehearsal),
    ],
  });

  // "0x" is the soft-read fallback, not a number: never hand it to BigInt().
  const revealed = hexIsNonZero(draw.seed);
  const awarded = draw.winners.length > 0;

  // ---- 2. the commit binds the seed ---------------------------------
  if (!revealed) {
    checks.push({
      key: "commit",
      title: "The commit binds the seed",
      status: "unavailable",
      lines: ["No seed has been revealed for this race yet, so there is nothing to check here."],
    });
  } else {
    const recomputed = commitHashOf(draw.seed);
    const match = recomputed.toLowerCase() === draw.commitHash.toLowerCase();
    checks.push({
      key: "commit",
      title: "The commit binds the seed",
      status: match ? "pass" : "fail",
      lines: [
        `keccak256(published seed) = ${recomputed}`,
        `commit recorded before the close   = ${draw.commitHash}`,
        match
          ? "The revealed seed hashes to the commit the operator posted while the draw was open."
          : "MISMATCH: the published seed does NOT hash to the recorded commit. The reveal should have been rejected on chain; treat this draw as suspect.",
      ],
    });
  }

  // ---- 3. the randomness binds the reveal block ---------------------
  let blockHash: Hex | null = null;
  if (revealed && draw.revealBlock > 0n) {
    try {
      const block = await testnetReadClient.getBlock({ blockNumber: draw.revealBlock });
      blockHash = (block.hash as Hex) ?? null;
    } catch {
      blockHash = null;
    }
    if (blockHash === null) {
      checks.push({
        key: "randomness",
        title: "The randomness binds the reveal block",
        status: "unavailable",
        lines: [
          `Block ${draw.revealBlock.toString()} could not be read back from the RPC, so the blockhash term cannot be recomputed here.`,
        ],
      });
    } else {
      const recomputed = finalRandomnessOf(draw.seed, blockHash, draw.drawId);
      const match = recomputed.toLowerCase() === draw.finalRandomness.toLowerCase();
      checks.push({
        key: "randomness",
        title: "The randomness binds the reveal block",
        status: match ? "pass" : "fail",
        lines: [
          `finalRandomness = keccak256(seed ++ blockhash(revealBlock) ++ uint256(drawId))`,
          `seed           = ${draw.seed}`,
          `blockhash(block ${draw.revealBlock.toString()}) = ${blockHash}`,
          `drawId         = ${draw.drawId.toString()}`,
          `recomputed     = ${recomputed}`,
          // A rehearsal value comes from this draw's own record, not from any
          // chain read: only its label drops the on-chain voice.
          rehearsal ? `draw record    = ${draw.finalRandomness}` : `on chain       = ${draw.finalRandomness}`,
          match
            ? "Exact match. The reveal block's hash is folded in, so the operator could not have chosen this randomness at commit time."
            : rehearsal
              ? "MISMATCH: the recomputed randomness differs from this draw's record. Either the inputs shown here differ from what the record holds, or the record has been tampered with."
              : "MISMATCH: the recomputed randomness differs from the chain's. Either the inputs shown here differ from what the contract used, or the record has been tampered with.",
        ],
      });
    }
  } else {
    checks.push({
      key: "randomness",
      title: "The randomness binds the reveal block",
      status: "unavailable",
      lines: ["This race has no reveal yet, so no randomness exists to recompute."],
    });
  }

  // ---- 4 + 5. winner derivation and match ---------------------------
  const racerTable: RacerTickets[] = draw.racers.map((r) => ({ tokenId: r.tokenId, tickets: r.tickets }));
  const walk = cumulativeWalk(racerTable);
  const derived = revealed && awarded ? deriveWinners(draw.finalRandomness, racerTable, draw.totalTickets, draw.winners.length) : null;

  if (!awarded || !revealed || !derived) {
    checks.push({
      key: "derive",
      title: "The winner derivation",
      status: "unavailable",
      lines: ["The draw has not published both a seed and a result, so there is no derivation to walk through yet."],
    });
  } else {
    const rows = derived.steps.map(
      (s) =>
        `slot ${s.slot}: keccak256(randomness ++ uint256(${s.slot})) = ${s.h} → index ${s.index.toString()} of ${formatTickets(draw.totalTickets)} → CHOG #${s.picked.toString()}${s.walked ? " (forward walk after a duplicate)" : ""}`,
    );
    checks.push({
      key: "derive",
      title: "The winner derivation, step by step",
      status: "info",
      lines: [
        "For every winner slot: h = keccak256(finalRandomness ++ uint256(slot)), then index = uint256(h) mod totalTickets, then the racer under that index in the frozen ticket walk below.",
        ...rows,
      ],
    });

    const exact =
      derived.winners.length === draw.winners.length &&
      derived.winners.every((w, i) => w === draw.winners[i]);

    // The contract's own deriveWinners() view only answers for the CURRENT
    // draw: its racer walk reads the current draw's racer set whatever drawId
    // it is handed, so for a past draw that view can return the wrong winners.
    // It is consulted and printed only when this race IS the current draw;
    // winnersOf() is the real per-draw getter and is what the check above
    // holds the recomputation against.
    const contractLines: string[] = [];
    let viewDisagrees = false;
    if (live) {
      // A failed read is not an answer: when the current draw id cannot be
      // read back, this page makes no claim about whether this race is the
      // current draw, and prints no view output either way.
      let currentId: bigint | null | "read-failed" = "read-failed";
      try {
        currentId = source ? await source.currentDrawId() : null;
      } catch {
        currentId = "read-failed";
      }
      if (currentId === "read-failed") {
        contractLines.push(
          "The engine's deriveWinners() view only answers for the current draw (it walks the current draw's racer set). The current draw id could not be read back on this RPC, so this page cannot say whether this race is the current draw and prints no view output here. winnersOf() above is the chain's per-draw getter and is the record this page checks against.",
        );
      } else if (currentId !== draw.drawId) {
        contractLines.push(
          "The engine's deriveWinners() view only answers for the current draw (it walks the current draw's racer set), and this race is not the current draw, so its output would not answer for this race and is not printed here. winnersOf() above is the chain's per-draw getter and is the record this page checks against.",
        );
      } else {
        try {
          const onChainDerived = await testnetReadClient.readContract({
            address: DEPLOYED.drawEngine as Address,
            abi: drawEngineAbi,
            functionName: "deriveWinners",
            args: [draw.drawId, BigInt(draw.winners.length)],
          });
          const arr = (onChainDerived as bigint[]).map((w) => w.toString());
          viewDisagrees =
            arr.length !== draw.winners.length || arr.some((v, i) => v !== draw.winners[i].toString());
          contractLines.push(
            viewDisagrees
              ? `LOUD DISAGREEMENT: this race IS the current draw, so deriveWinners() answers for it, but the view returns [${arr.join(", ")}] while winnersOf(${draw.drawId.toString()}) records [${draw.winners.map((w) => w.toString()).join(", ")}]. Two on-chain answers disagree; treat this draw as suspect until the difference is explained.`
              : `The contract's own deriveWinners() view returns [${arr.join(", ")}]. This race is the current draw, so the view answers for it, and it agrees with winnersOf() and with the recomputation above.`,
          );
        } catch {
          contractLines.push(
            "The contract's own deriveWinners() view did not answer for this race (it walks the current draw's racer set), so the walk above is shown from the draw's own frozen book instead.",
          );
        }
      }
    }

    checks.push({
      key: "match",
      title: verifyMatchTitle(rehearsal),
      status: exact && !viewDisagrees ? "pass" : "fail",
      lines: [
        `Recomputed winners: [${derived.winners.map((w) => w.toString()).join(", ")}]`,
        verifyRecordedWinnersLine(draw.drawId.toString(), draw.winners, rehearsal),
        ...contractLines,
        exact
          ? viewDisagrees
            ? "The recomputation matches winnersOf(), but the deriveWinners() view above does not. The disagreement is the view's, and it is flagged in red on purpose."
            : "Exact match. Anyone running this page or this formula against the same published seed gets the same winners."
          : "LOUD MISMATCH: the published seed does not reproduce the recorded winners. Do not trust this draw until the difference is explained.",
      ],
    });
  }

  // ---- 6. the frozen book is self-consistent ------------------------
  if (!live) {
    checks.push({
      key: "book",
      title: "The frozen ticket book",
      status: "unavailable",
      lines: [
        "This dev record predates the live deployment, so the book cross-check waits for a live draw. The book used in the derivation above is the recorded one, exactly as the draw froze it.",
      ],
    });
  } else {
  try {
    const crossReads = await Promise.all(
      draw.racers.flatMap((r) => [
        testnetReadClient.readContract({
          address: DEPLOYED.drawEngine as Address,
          abi: drawEngineAbi,
          functionName: "ticketsOf",
          args: [draw.drawId, r.tokenId],
        }),
        testnetReadClient.readContract({
          address: DEPLOYED.pool as Address,
          abi: poolAbi,
          functionName: "ticketsOfFrozen",
          args: [draw.drawId, r.tokenId],
        }),
      ]),
    );
    const disagreements: string[] = [];
    draw.racers.forEach((r, i) => {
      const engine = crossReads[i * 2] as bigint | undefined;
      const pool = crossReads[i * 2 + 1] as bigint | undefined;
      if (engine !== pool) {
        disagreements.push(`CHOG #${r.tokenId.toString()}: draw engine ${engine?.toString() ?? "?"} vs pool ${pool?.toString() ?? "?"}`);
      }
    });
    checks.push({
      key: "book",
      title: "The frozen ticket book",
      status: disagreements.length === 0 ? "pass" : "fail",
      lines:
        disagreements.length === 0
          ? [
              "Every racer's ticket count reads identically from the draw engine's own snapshot and from the pool's frozen book:",
              ...draw.racers.map((r) => `CHOG #${r.tokenId.toString()}: ${formatTickets(r.tickets)} tickets`),
            ]
          : [`Disagreements found:`, ...disagreements],
    });
  } catch {
    checks.push({
      key: "book",
      title: "The frozen ticket book",
      status: "unavailable",
      lines: ["The cross-read of the frozen book did not answer on this RPC."],
    });
  }
  }

  // ---- 7 + 8. mirror URI records and trophy inscriptions, per winner ----
  const mirrors: MirrorUriCheck[] = [];
  let scanNote: string | null = null;
  // A dev draw can carry its own RaceRecorded trail; live draws get theirs
  // from a real event-log scan below.
  let scannedInscriptions: RaceRecordedLine[] = draw.recordedInscriptions ?? [];

  if (awarded && live) {
    for (const winner of draw.winners) {
      try {
        const [badge, chog] = await Promise.all([readMirrorBadge(winner), readChog(winner).catch(() => null)]);
        // ChogMirror hashes the URI WITHOUT its Test Drive label at mint
        // (keccak256(bytes(realURI))), while tokenURI() returns the labelled
        // string. The recomputation must hash the same bytes the contract did,
        // so the label is stripped first; the stripped value is also what the
        // mainnet-URI comparison below compares.
        const { hashedUri: cleanStored, computedHash, hashMatch } = checkMirrorUriHash(
          badge.storedUri,
          badge.recordedUriHash,
        );
        const mainnetUri = chog ? chog.tokenURI : null;
        const mainnetMatch = mainnetUri === null ? null : cleanStored === mainnetUri;
        mirrors.push({
          tokenId: winner,
          badgeLabel: badge.badgeLabel,
          storedUri: badge.storedUri,
          hashedUri: cleanStored,
          recordedHash: badge.recordedUriHash,
          computedHash,
          hashMatch,
          mainnetUri,
          mainnetMatch,
          metadataName: chog?.metadata.name ?? null,
        });
      } catch {
        checks.push({
          key: `mirror-${winner.toString()}`,
          title: `The mirror's URI record for CHOG #${winner.toString()}`,
          status: "unavailable",
          lines: ["The mirror read for this winner did not answer on this RPC."],
        });
      }
    }

    try {
      const events = await readDrawEvents(draw);
      scannedInscriptions = events.inscriptions;
      scanNote = `Event logs scanned for blocks ${events.scannedFrom.toString()} to ${events.scannedTo.toString()} (the public RPC caps log ranges at 100 blocks per call); events outside that window are not scanned.`;
    } catch {
      scanNote = "The event log scan did not answer on this RPC; the CareerStore's own reads above still stand.";
    }

    for (const mirror of mirrors) {
      checks.push({
        key: `mirror-${mirror.tokenId.toString()}`,
        title: `The mirror's URI record for CHOG #${mirror.tokenId.toString()}`,
        status: mirror.hashMatch === false ? "fail" : mirror.hashMatch === true ? "pass" : "unavailable",
        lines: [
          `Mirror badge: ${mirror.badgeLabel}`,
          `Stored URI: ${mirror.storedUri}`,
          mirror.recordedHash === null
            ? "The deployed mirror does not expose a recorded URI hash (this deployment predates the binding), so the digest cannot be compared on chain yet. The mirror contract now binds keccak256 of the stored URI into the owner's signed message, so once minted through that path this check reads the binding directly."
            : `${mirror.hashedUri === mirror.storedUri ? "keccak256(stored URI bytes)" : "keccak256(stored URI bytes with the Test Drive label stripped)"} = ${mirror.computedHash}`,
          mirror.recordedHash === null
            ? ""
            : mirror.hashMatch
              ? mirror.hashedUri === mirror.storedUri
                ? "The stored URI hashes to the digest recorded at mint. For a Verified Holder token that digest is the one the mainnet owner signed."
                : "The stored URI, with its Test Drive label stripped, hashes to the digest recorded at mint. The label is a display prefix the mirror adds on read; the mint recorded the digest over the URI alone."
              : "MISMATCH: the stored URI does not hash to the recorded digest.",
          mirror.mainnetUri === null
            ? "The live mainnet tokenURI for this token could not be read."
            : `Live mainnet tokenURI: ${mirror.mainnetUri}`,
          mirror.mainnetUri === null
            ? ""
            : mirror.mainnetMatch
              ? "The stored URI is exactly the URI the Chog Genesis contract resolves for this token."
              : "NOTE: the URI stored in the mirror differs from the live mainnet tokenURI of this token. The mirror is a testnet rehearsal token; the race show and this verifier always display metadata from the live mainnet URI.",
        ].filter(Boolean),
      });
    }

    for (const winner of draw.winners) {
      let record: CareerRecord | null = null;
      try {
        record = await readCareer(winner, draw.drawId);
      } catch {
        record = null;
      }
      if (!record) {
        checks.push({
          key: `career-${winner.toString()}`,
          title: verifyCareerTitle(winner.toString(), rehearsal),
          status: "unavailable",
          lines: ["The CareerStore read for this winner did not answer on this RPC."],
        });
        continue;
      }
      const inscription = scannedInscriptions.find((i) => i.tokenId.toString() === winner.toString());
      checks.push({
        key: `career-${winner.toString()}`,
        title: verifyCareerTitle(winner.toString(), rehearsal),
        status: record.placementInRace > 0 ? "pass" : "fail",
        lines: [
          `placementOf(CHOG #${winner.toString()}, ${draw.drawId.toString()}) = ${record.placementInRace}`,
          `Career after this race: ${record.gold} gold, ${record.silver} silver, ${record.bronze} bronze, ${record.races} race(s) recorded.`,
          inscription
            ? `RaceRecorded(CHOG #${inscription.tokenId.toString()}, race ${draw.drawId.toString()}, placement ${inscription.placement}) at block ${inscription.blockNumber.toString()}, tx ${shortHex(inscription.txHash, 10, 8)}.`
            : "No RaceRecorded event for this winner appeared in the scanned block window; the store's own placement read above is the durable record.",
          scanNote ?? "",
        ].filter(Boolean),
      });
    }
  } else if (awarded && draw.recordedCareers) {
    // A dev draw that carries its own trophy record: every winner gets its own
    // card from that record, with the source spelled out on the record card at
    // the top of this page. No second on-chain race is invented here.
    for (const winner of draw.winners) {
      const record = draw.recordedCareers[winner.toString()] ?? null;
      if (!record) {
        checks.push({
          key: `career-${winner.toString()}`,
          title: verifyCareerTitle(winner.toString(), rehearsal),
          status: "unavailable",
          lines: ["This draw's record carries no trophy row for this winner."],
        });
        continue;
      }
      const inscription = scannedInscriptions.find((i) => i.tokenId.toString() === winner.toString());
      checks.push({
        key: `career-${winner.toString()}`,
        title: verifyCareerTitle(winner.toString(), rehearsal),
        // A rehearsal's rows are its own readings, nothing a deployed store
        // backs, so they never wear the green badge; a real record still gets
        // pass or fail against the row itself.
        status: record.placementInRace > 0 ? (rehearsal ? "info" : "pass") : "fail",
        footer: "READ FROM THIS DRAW'S OWN RECORD",
        lines: [
          `Placement of CHOG #${winner.toString()} in this draw's record: ${record.placementInRace}`,
          `Career after this race: ${record.gold} gold, ${record.silver} silver, ${record.bronze} bronze, ${record.races} race(s) recorded.`,
          inscription
            ? `RaceRecorded(CHOG #${inscription.tokenId.toString()}, race ${draw.drawId.toString()}, placement ${inscription.placement}) at block ${inscription.blockNumber.toString()}, tx ${shortHex(inscription.txHash, 10, 8)}.`
            : "This draw's record carries no RaceRecorded event for this winner; the placement above is the record.",
        ],
      });
    }
    checks.push({
      key: "mirror",
      title: "The mirror's URI record for the winners",
      status: "unavailable",
      lines: ["The mirror records for these winners live on the deployed mirror, and this dev record predates it. The check runs in full against live draws."],
    });
  } else if (awarded) {
    checks.push({
      key: "mirror",
      title: "The mirror's URI record for the winners",
      status: "unavailable",
      lines: ["The mirror and career records for this draw live on the live stack, and this dev record predates it. Both checks run in full against live draws."],
    });
    checks.push({
      key: "career",
      title: "Trophy inscriptions in the CareerStore",
      status: "unavailable",
      lines: ["The CareerStore inscription for this draw is checked in full against live draws."],
    });
  }

  // ---- verdict -------------------------------------------------------
  // The banner is honest about the WHOLE page: any failing check, cross-check
  // included, downgrades the verdict. A green VERIFIED never sits over a red
  // card. Checks that could not run are named in the line instead of hidden.
  const failed = checks.filter((c) => c.status === "fail");
  const coreKeys = new Set(["commit", "randomness", "match"]);
  const coreUnavailable = checks.filter((c) => coreKeys.has(c.key) && c.status === "unavailable");
  const extraUnavailable = checks.filter((c) => !coreKeys.has(c.key) && c.status === "unavailable");
  let verdict: Verification["verdict"];
  let verdictLine: string;
  if (failed.length > 0) {
    verdict = "mismatch";
    verdictLine = failed.some((c) => coreKeys.has(c.key))
      ? verdictCoreMismatchLine(rehearsal)
      : VERDICT_CROSS_MISMATCH_LINE;
  } else if (coreUnavailable.length > 0 || !awarded) {
    verdict = "incomplete";
    verdictLine = VERDICT_INCOMPLETE_LINE;
  } else {
    verdict = "verified";
    verdictLine = verdictVerifiedLine(rehearsal, extraUnavailable.length > 0);
  }

  return {
    draw,
    checks,
    walk,
    steps: derived ? derived.steps : [],
    racerTable,
    verdict,
    verdictLine,
  };
}
