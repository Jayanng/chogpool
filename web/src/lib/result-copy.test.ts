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
  prizeCanvasLabel,
  prizePerWinner,
  splitCanvasLabel,
  trophySentence,
  winnerHeadline,
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
