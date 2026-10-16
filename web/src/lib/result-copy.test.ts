// Multi-winner result copy. A draw with several winner slots must mark every
// winner, name every winner, frame the prize as each winner's even share, and
// only claim on-chain recording when the page holds the RaceRecorded evidence
// for it. These tests pin all four.

import { describe, expect, it } from "vitest";
import type { DrawRecord } from "../types/race";
import {
  inscriptionFor,
  ipfsName,
  isWinnerToken,
  podiumPlacesFooter,
  podiumPrizeSentence,
  prizeCanvasLabel,
  prizePerWinner,
  replayDisclosure,
  replayHeadline,
  resultStripCopy,
  shareBadgeLabel,
  shareFooterLabel,
  shareSubLabel,
  splitCanvasLabel,
  trophySentence,
  verdictCoreMismatchLine,
  verdictVerifiedLine,
  verifyCareerTitle,
  verifyMatchTitle,
  verifyPrizeLine,
  verifyRecordTitle,
  verifyRecordedWinnersLine,
  verifyWinnersLine,
  winnerHeadline,
  winnerKickerLabel,
  winnerListLabel,
  type InscriptionEvidence,
} from "./result-copy";

// Test data in the exact shape the chain records a draw: two winner slots over
// a three-racer book, so the pot splits evenly and one racer is a non-winner.
const draw: DrawRecord = {
  drawId: 7n,
  state: "awarded",
  closeAt: 1792068183,
  commitHash: "0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7",
  seed: "0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703",
  finalRandomness: "0xafb6d2d3faab8959a6dc32ef1d4eaa589d90bc8c6a736ddf967dcc3990c26c09",
  revealBlock: 71255613n,
  totalTickets: 71186086n,
  potPerWinner: 22941n,
  winners: [1462n, 954n],
  racers: [
    { tokenId: 1462n, tickets: 52934966n, tier: 0, boost: 0n },
    { tokenId: 954n, tickets: 18251120n, tier: 0, boost: 0n },
    { tokenId: 7n, tickets: 1n, tier: 0, boost: 0n },
  ],
};

describe("a multi-winner draw marks every winner", () => {
  it("marks both on-chain winners and nobody else", () => {
    const marked = draw.racers.filter((r) => isWinnerToken(draw.winners, r.tokenId));
    expect(marked.map((r) => r.tokenId)).toEqual([1462n, 954n]);
  });

  it("names every winner in the headline and the list", () => {
    expect(winnerListLabel(draw.winners)).toBe("CHOG #1462 and CHOG #954");
    const headline = winnerHeadline(draw.winners);
    for (const w of draw.winners) {
      expect(headline).toContain(`CHOG #${w.toString()}`);
    }
    expect(headline).toBe("CHOG #1462 and CHOG #954 take the race.");
  });
});

describe("single-winner copy keeps its voice", () => {
  it("still reads as one winner taking the race", () => {
    expect(winnerHeadline([1462n])).toBe("CHOG #1462 takes the race.");
    expect(winnerListLabel([1462n])).toBe("CHOG #1462");
    expect(isWinnerToken([1462n], 1462n)).toBe(true);
    expect(isWinnerToken([1462n], 954n)).toBe(false);
  });
});

describe("the prize is framed as each winner's share", () => {
  it("says each winner's even share when the pot splits", () => {
    expect(prizePerWinner(draw.winners, "0.022941 USDC")).toBe("0.022941 USDC each");
    expect(prizeCanvasLabel(draw.winners, "0.022941 USDC")).toBe("Prize 0.022941 USDC each");
    expect(splitCanvasLabel(draw.winners)).toBe("Pot split evenly across 2 winners");
  });

  it("keeps the one-winner framing when the pot is not split", () => {
    expect(prizePerWinner([1462n], "0.022941 USDC")).toBe("0.022941 USDC");
    expect(prizeCanvasLabel([1462n], "0.022941 USDC")).toBe("Prize 0.022941 USDC");
    expect(splitCanvasLabel([1462n])).toBe("Paid from the yield-funded pot");
  });
});

describe("the trophy line only claims what the screen can show", () => {
  const career = { gold: 1, silver: 0, bronze: 1, races: 3, placementInRace: 1 };
  const inscription: InscriptionEvidence = {
    tokenId: 1462n,
    placement: 1,
    blockNumber: 71255690n,
    txHash: `0x${"ab12".repeat(16)}`,
  };

  it("claims the recording when the RaceRecorded event backs it", () => {
    const line = trophySentence(career, inscription);
    expect(line).toContain("Recorded on chain");
    expect(line).toContain("Trophy case after this race");
  });

  it("never claims a recording without the inscription event", () => {
    const line = trophySentence(career, null);
    expect(line).not.toContain("Recorded");
    expect(line).toContain("Read live from the CareerStore");
  });

  it("never claims a recording when the store counts no races", () => {
    const line = trophySentence({ ...career, races: 0, placementInRace: 0 }, inscription);
    expect(line).not.toContain("Recorded");
    expect(line).toContain("across 0 races");
  });

  it("never claims a recording when only placementInRace is zero", () => {
    const line = trophySentence({ ...career, placementInRace: 0 }, inscription);
    expect(line).not.toContain("Recorded");
    expect(line).toContain("Read live from the CareerStore");
    expect(line).toContain("across 3 races");
  });

  it("never claims a recording when the event's placement disagrees with the store", () => {
    const line = trophySentence(career, { ...inscription, placement: 2 });
    expect(line).not.toContain("Recorded");
    expect(line).toContain("Read live from the CareerStore");
  });

  it("says where the counts came from when the draw carries them", () => {
    const line = trophySentence(career, null, "draw-record");
    expect(line).not.toContain("Recorded");
    expect(line).toContain("Carried in this draw's own record");
    expect(line).not.toContain("Read live");
  });

  it("finds the right winner's inscription among several", () => {
    const inscriptions: InscriptionEvidence[] = [
      inscription,
      { tokenId: 954n, placement: 2, blockNumber: 71255690n, txHash: `0x${"cd34".repeat(16)}` },
    ];
    expect(inscriptionFor(inscriptions, 954n)?.placement).toBe(2);
    expect(inscriptionFor(inscriptions, 1462n)?.placement).toBe(1);
    expect(inscriptionFor(inscriptions, 7n)).toBeNull();
  });
});

describe("IPFS names are only claimed from real metadata", () => {
  it("reports a real metadata name and drops the tokenId fallback", () => {
    expect(ipfsName(1462n, "Moss King")).toBe("Moss King");
    expect(ipfsName(1462n, "Chog #1462")).toBeNull();
    expect(ipfsName(1462n, "CHOG #1462")).toBeNull();
    expect(ipfsName(1462n, "Moss King", true)).toBeNull();
    expect(ipfsName(1462n, null)).toBeNull();
    expect(ipfsName(1462n, undefined)).toBeNull();
  });

  it("drops the real mainnet quirk: token 1462's metadata name is literally CHOG #954", () => {
    // Real data: tokenURI(1462) resolves to 954.json, whose name field reads
    // "CHOG #954". That is the collection's own file numbering, not a name.
    expect(ipfsName(1462n, "CHOG #954")).toBeNull();
    expect(ipfsName("1462", "Chog #954")).toBeNull();
    expect(ipfsName(954n, "CHOG #1462")).toBeNull();
  });
});

describe("three winners read with clean grammar", () => {
  it("joins the list with commas and one 'and'", () => {
    expect(winnerListLabel([1462n, 954n, 7n])).toBe("CHOG #1462, CHOG #954 and CHOG #7");
    expect(winnerHeadline([1462n, 954n, 7n])).toBe("CHOG #1462, CHOG #954 and CHOG #7 take the race.");
  });
});

describe("a zero pot is never a payment claim", () => {
  it("says so on the canvas labels", () => {
    expect(prizeCanvasLabel([1462n], "0 USDC", true)).toBe("No prize to pay out this draw");
    expect(splitCanvasLabel([1462n], true)).toBe("The pot split to zero per winner");
    expect(prizeCanvasLabel([1462n, 954n], "0 USDC", true)).toBe("No prize to pay out this draw");
    expect(splitCanvasLabel([1462n, 954n], true)).toBe("The pot split to zero per winner");
    // A funded pot keeps the normal wording.
    expect(prizeCanvasLabel([1462n], "0.022941 USDC")).toBe("Prize 0.022941 USDC");
  });
});

// A rehearsal draw (one that exists only in its own record) must never claim
// an on-chain draw, a winnersOf() answer, or a payment. These pin the
// rehearsal wording on every surface AND the unchanged wording real draws
// keep, so fixing the rehearsal paths cannot dumb down the real ones.
describe("a rehearsal draw reads as its own record, never as chain truth", () => {
  const args = {
    rehearsal: true,
    winnersLabel: "CHOG #1462 and CHOG #954",
    winnerCount: 2,
    prizeLabel: "0.01147 USDC each",
    potLabel: "0.01147 USDC",
    zeroPot: false,
  };

  it("labels the result strip a rehearsal and says no money moved", () => {
    const strip = resultStripCopy(args);
    expect(strip.badge).toBe("REHEARSAL RESULT");
    expect(strip.body).toContain("DEV REHEARSAL, NOT AN ON-CHAIN DRAW");
    expect(strip.body).toContain("This draw's record holds winners CHOG #1462 and CHOG #954");
    expect(strip.body).toContain("split as award() would have");
    expect(strip.body).toContain("No money moved");
    expect(strip.body).not.toContain("The chain");
    expect(strip.body).not.toContain("paid");
  });

  it("drops winnersOf() from the winner kicker", () => {
    expect(winnerKickerLabel("2", true)).toBe("WINNER IN THIS DRAW'S RECORD");
    expect(winnerKickerLabel("2", true)).not.toContain("winnersOf");
    expect(winnerKickerLabel("2", true)).not.toContain("ON-CHAIN");
  });

  it("prizes the split as award() would have, never as paid", () => {
    const line = podiumPrizeSentence({
      rehearsal: true,
      winners: [1462n, 954n],
      potLabel: "0.01147 USDC",
      zeroPot: false,
      team: "0xc0aB4800...A23FD4B2",
    });
    expect(line).toContain("Prize split as award() would have: 0.01147 USDC each");
    expect(line).toContain("No money moved for this rehearsal");
    expect(line).not.toContain("Prize paid");
    expect(line).not.toContain("straight from the yield-funded pot");
  });

  it("says the winning places come from the draw's own record", () => {
    expect(podiumPlacesFooter(2, true)).toBe("Only the 2 winning places come from this draw's record.");
    expect(podiumPlacesFooter(1, true)).toBe("Only place 1 comes from this draw's record.");
  });

  it("never says the draw itself is decided on chain", () => {
    expect(replayHeadline(true)).toBe("The replay of this draw's record.");
    expect(replayDisclosure(true)).not.toContain("decided on chain");
    expect(replayDisclosure(true)).toContain("This draw's record decides the result");
  });

  it("wears the rehearsal badge and footer on the share card", () => {
    expect(shareBadgeLabel(true)).toBe("REHEARSAL RESULT");
    expect(shareFooterLabel(2, true)).toBe("VALUES IN THIS REHEARSAL RECORD");
    expect(shareFooterLabel(1, true)).toBe("VALUES IN THIS REHEARSAL RECORD");
    expect(shareSubLabel(null, true, true)).toBe("WINNER IN THIS DRAW'S RECORD");
    expect(shareSubLabel("Moss King", true, true)).toBe("IPFS NAME: MOSS KING");
  });

  it("keeps money wording conditional on the share card canvas", () => {
    expect(splitCanvasLabel([1462n, 954n], false, true)).toBe("Pot split as award() would have");
    expect(splitCanvasLabel([1462n], false, true)).toBe("Award() would have paid the pot");
    expect(splitCanvasLabel([1462n, 954n], false, true)).not.toContain("Pot split evenly across");
  });

  it("reads the verifier cards as this draw's record", () => {
    expect(verifyRecordTitle(true)).toBe("What this draw's record holds");
    expect(verifyWinnersLine([1462n, 954n], true)).toBe("Winners in this draw's record: 1462, 954");
    expect(verifyPrizeLine("0.01147 USDC", true)).toBe("Prize per winner (as award() would split it): 0.01147 USDC");
    expect(verifyMatchTitle(true)).toBe("Recomputed vs this draw's record");
    expect(verifyRecordedWinnersLine("2", [1462n, 954n], true)).toBe("This draw's record: [1462, 954]");
    expect(verifyCareerTitle("954", true)).toBe("Trophy rows in this draw's own record for CHOG #954");
  });

  it("scopes the verdict to the draw's own record", () => {
    const verified = verdictVerifiedLine(true, false);
    expect(verified).toContain("re-derives this draw's record exactly");
    expect(verified).not.toContain("on-chain record");
    expect(verdictCoreMismatchLine(true)).not.toContain("the chain's own record");
    expect(verdictCoreMismatchLine(true)).toContain("does not reproduce this draw's own record");
  });
});

describe("real draws keep their exact chain wording", () => {
  const args = {
    rehearsal: false,
    winnersLabel: "CHOG #1462 and CHOG #954",
    winnerCount: 2,
    prizeLabel: "0.01147 USDC each",
    potLabel: "0.01147 USDC",
    zeroPot: false,
  };

  it("keeps the result strip byte for byte", () => {
    const strip = resultStripCopy(args);
    expect(strip.badge).toBe("ON-CHAIN RESULT");
    expect(strip.body).toBe(
      "The chain already recorded this race: winners CHOG #1462 and CHOG #954, paid 0.01147 USDC each, the pot split evenly across the winners. The replay on screen is that result, frame for frame, every time.",
    );
  });

  it("keeps the single-winner strip wording", () => {
    const strip = resultStripCopy({ ...args, winnersLabel: "CHOG #1462", winnerCount: 1, prizeLabel: "0.022941 USDC" });
    expect(strip.body).toBe(
      "The chain already recorded this race: winner CHOG #1462, paid 0.022941 USDC. The replay on screen is that result, frame for frame, every time.",
    );
  });

  it("keeps winnersOf() in the kicker and the prize as paid", () => {
    expect(winnerKickerLabel("1", false)).toBe("ON-CHAIN WINNER · winnersOf(1)");
    expect(
      podiumPrizeSentence({
        rehearsal: false,
        winners: [1462n, 954n],
        potLabel: "0.01147 USDC",
        zeroPot: false,
        team: "0xc0aB4800...A23FD4B2",
      }),
    ).toBe(
      "Prize paid: 0.01147 USDC each, the pot split evenly across 2 winners, straight from the yield-funded pot to the depositor behind the position (0xc0aB4800...A23FD4B2).",
    );
    expect(
      podiumPrizeSentence({ rehearsal: false, winners: [1462n], potLabel: "0.022941 USDC", zeroPot: false, team: null }),
    ).toBe("Prize paid: 0.022941 USDC, straight from the yield-funded pot to the depositor behind the position.");
  });

  it("keeps the podium, share and verifier wording", () => {
    expect(podiumPlacesFooter(1, false)).toBe("Only place 1 is decided on chain.");
    expect(podiumPlacesFooter(2, false)).toBe("Only the 2 winning places are decided on chain.");
    expect(replayHeadline(false)).toBe("The replay of the real result.");
    expect(replayDisclosure(false)).toContain("The draw itself is decided on chain");
    expect(shareBadgeLabel(false)).toBe("REAL DRAW RESULT");
    expect(shareFooterLabel(2, false)).toBe("WINNERS AND PRIZE READ FROM THE CHAIN");
    expect(shareFooterLabel(1, false)).toBe("WINNER AND PRIZE READ FROM THE CHAIN");
    expect(shareSubLabel(null, true, false)).toBe("ON-CHAIN WINNER");
    expect(shareSubLabel(null, false, false)).toBe("");
    expect(splitCanvasLabel([1462n], false, false)).toBe("Paid from the yield-funded pot");
    expect(splitCanvasLabel([1462n, 954n], false, false)).toBe("Pot split evenly across 2 winners");
  });

  it("keeps the verifier's chain wording and the honest scoping line", () => {
    expect(verifyRecordTitle(false)).toBe("What the chain records for this race");
    expect(verifyWinnersLine([1462n], false)).toBe("Winners on chain (winnersOf): 1462");
    expect(verifyPrizeLine("0.022941 USDC", false)).toBe("Prize per winner (potPerWinnerOf): 0.022941 USDC");
    expect(verifyMatchTitle(false)).toBe("Recomputed vs the on-chain record");
    expect(verifyRecordedWinnersLine("1", [1462n], false)).toBe("winnersOf(1) : [1462]");
    expect(verifyCareerTitle("1462", false)).toBe("Trophy inscription in the CareerStore for CHOG #1462");
    expect(verdictVerifiedLine(false, false)).toBe(
      "VERIFIED: the published seed re-derives the on-chain record exactly. Same seed, same winners, for anyone who checks.",
    );
    // The checks render below the verdict banner, and the line says so.
    expect(verdictVerifiedLine(false, true)).toContain("The checks marked NOT AVAILABLE below");
    expect(verdictCoreMismatchLine(false)).toBe(
      "MISMATCH: this race's published seed does not reproduce the chain's own record. The steps below say exactly where.",
    );
  });
});
