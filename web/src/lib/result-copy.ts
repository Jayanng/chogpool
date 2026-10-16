// Pure result copy: every string here is computed from the draw's own record.
// A claim of on-chain recording only ever appears when the caller passes the
// RaceRecorded inscription evidence for the shown token in this draw, so the
// page never asserts a recording its own data contradicts.

/** One CareerStore RaceRecorded event for this draw, as the logs hold it. */
export type InscriptionEvidence = {
  tokenId: bigint;
  placement: number;
  blockNumber: bigint;
  txHash: string;
};

/** The career counts a trophy line reports, plus this race's placement. */
export type CareerCounts = {
  gold: number;
  silver: number;
  bronze: number;
  races: number;
  placementInRace: number;
};

/** Where the career counts on screen came from. */
export type CareerSource = "live-read" | "draw-record";

/** The short strip every rehearsal surface carries. A rehearsal draw exists
 *  only in its own record: no on-chain draw produced it and no money moved. */
export const REHEARSAL_STRIP = "DEV REHEARSAL, NOT AN ON-CHAIN DRAW";

/** True when the chain recorded this token among the draw's winners. */
export function isWinnerToken(winners: readonly bigint[], tokenId: bigint): boolean {
  const key = tokenId.toString();
  return winners.some((w) => w.toString() === key);
}

/** "A", "A and B", "A, B and C". */
export function joinWithAnd(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** One label per winner: "CHOG #1462". */
export function winnerTokenLabels(winners: readonly bigint[]): string[] {
  return winners.map((w) => `CHOG #${w.toString()}`);
}

/** Every winner named, in payout order. */
export function winnerListLabel(winners: readonly bigint[]): string {
  return joinWithAnd(winnerTokenLabels(winners));
}

/** The podium headline. Reads right for one winner and for a split field. */
export function winnerHeadline(winners: readonly bigint[]): string {
  if (winners.length === 0) return "No winner is recorded for this race.";
  const names = winnerListLabel(winners);
  return winners.length === 1 ? `${names} takes the race.` : `${names} take the race.`;
}

/** The per-winner prize. With several winners the pot is that amount each. */
export function prizePerWinner(winners: readonly bigint[], potLabel: string): string {
  return winners.length > 1 ? `${potLabel} each` : potLabel;
}

/** Share card prize line. A zero split is not a payment and never claims one. */
export function prizeCanvasLabel(winners: readonly bigint[], potLabel: string, zeroPot = false): string {
  if (zeroPot) return "No prize to pay out this draw";
  return winners.length > 1 ? `Prize ${potLabel} each` : `Prize ${potLabel}`;
}

/** Share card line for where the prize came from. A rehearsal card never says
 *  money moved: it names what award() would have done instead. */
export function splitCanvasLabel(winners: readonly bigint[], zeroPot = false, rehearsal = false): string {
  if (zeroPot) return "The pot split to zero per winner";
  if (rehearsal) {
    return winners.length > 1 ? "Pot split as award() would have" : "Award() would have paid the pot";
  }
  return winners.length > 1
    ? `Pot split evenly across ${winners.length} winners`
    : "Paid from the yield-funded pot";
}

/** The RaceRecorded event for this token in this draw, when the logs hold one. */
export function inscriptionFor(
  inscriptions: readonly InscriptionEvidence[],
  tokenId: bigint,
): InscriptionEvidence | null {
  const key = tokenId.toString();
  return inscriptions.find((i) => i.tokenId.toString() === key) ?? null;
}

/**
 * The trophy line. It may claim an on-chain recording only when the page holds
 * the RaceRecorded event for this token in this draw, the store's own counts
 * back it up, AND the event's placement agrees with the recorded placement;
 * otherwise the numbers are reported as the plain read they are.
 */
export function trophySentence(
  career: CareerCounts,
  inscription: InscriptionEvidence | null,
  source: CareerSource = "live-read",
): string {
  const counts =
    `${career.gold} gold, ${career.silver} silver, ${career.bronze} bronze ` +
    `across ${career.races} race${career.races === 1 ? "" : "s"}`;
  const recorded =
    inscription !== null &&
    career.races > 0 &&
    career.placementInRace > 0 &&
    inscription.placement === career.placementInRace;
  return recorded
    ? `Trophy case after this race: ${counts}. Recorded on chain in the RaceRecorded event below.`
    : `Career on record so far: ${counts}. ${
        source === "live-read" ? "Read live from the CareerStore." : "Carried in this draw's own record."
      }`;
}

/**
 * The racer's real IPFS metadata name, or null when what the record holds is
 * not a name at all. The collection numbers its metadata files differently
 * from tokenIds (token 1462 resolves to 954.json, so its name reads
 * "CHOG #954"), so any "CHOG #NNN" name is the collection's own numbering and
 * is treated as absent on every surface. Token IDs lead.
 */
export function ipfsName(
  tokenId: bigint | string,
  name: string | null | undefined,
  metadataMissing = false,
): string | null {
  if (metadataMissing || !name) return null;
  return /^CHOG #\d+$/i.test(name.trim()) ? null : name;
}

/* ------------------------------------------------------------------ *
 * Provenance wording. A real draw reads as chain truth; a rehearsal
 * draw (one that exists only in its own record) reads as its own
 * record everywhere and never says "on chain" or "paid".
 * ------------------------------------------------------------------ */

/** The race show's result strip: badge and sentence. */
export function resultStripCopy(args: {
  rehearsal: boolean;
  winnersLabel: string;
  winnerCount: number;
  /** Per-winner share, already labeled (e.g. "0.01147 USDC each"). */
  prizeLabel: string;
  potLabel: string;
  zeroPot: boolean;
}): { badge: string; body: string } {
  const { rehearsal, winnersLabel, winnerCount, prizeLabel, potLabel, zeroPot } = args;
  const countWord = winnerCount === 1 ? "winner" : "winners";
  if (rehearsal) {
    const prizePart = zeroPot
      ? `with no prize to pay out (the pot's split came out to ${potLabel} per winner)`
      : `with the prize split as award() would have: ${prizeLabel}${
          winnerCount > 1 ? ", the pot split evenly across the winners" : ""
        }`;
    return {
      badge: "REHEARSAL RESULT",
      body: `${REHEARSAL_STRIP}. This draw's record holds ${countWord} ${winnersLabel}, ${prizePart}. No money moved. The replay on screen is that record, frame for frame, every time.`,
    };
  }
  const prizePart = zeroPot
    ? `with no prize to pay out (the pot's split came out to ${potLabel} per winner)`
    : `paid ${prizeLabel}${winnerCount > 1 ? ", the pot split evenly across the winners" : ""}`;
  return {
    badge: "ON-CHAIN RESULT",
    body: `The chain already recorded this race: ${countWord} ${winnersLabel}, ${prizePart}. The replay on screen is that result, frame for frame, every time.`,
  };
}

/** The kicker over each podium winner block. */
export function winnerKickerLabel(drawId: string, rehearsal: boolean): string {
  return rehearsal ? "WINNER IN THIS DRAW'S RECORD" : `ON-CHAIN WINNER · winnersOf(${drawId})`;
}

/** The prize sentence in a podium winner block. */
export function podiumPrizeSentence(args: {
  rehearsal: boolean;
  winners: readonly bigint[];
  potLabel: string;
  zeroPot: boolean;
  /** Shortened depositor address, or null when none is bound. */
  team?: string | null;
}): string {
  const { rehearsal, winners, potLabel, zeroPot, team } = args;
  const to = team ? ` (${team})` : "";
  if (rehearsal) {
    return zeroPot
      ? `No prize to pay out in this record: the pot's split came out to ${potLabel} per winner.`
      : `Prize split as award() would have: ${prizePerWinner(winners, potLabel)}` +
          (winners.length > 1 ? `, the pot split evenly across ${winners.length} winners` : "") +
          `. No money moved for this rehearsal; award() would have paid the depositor behind the position${to}.`;
  }
  return zeroPot
    ? `No prize to pay out this draw: the pot's split came out to ${potLabel} per winner.`
    : `Prize paid: ${prizePerWinner(winners, potLabel)}` +
        (winners.length > 1 ? `, the pot split evenly across ${winners.length} winners` : "") +
        `, straight from the yield-funded pot to the depositor behind the position${to}.`;
}

/** The podium's line about which places are decided where. */
export function podiumPlacesFooter(winnerCount: number, rehearsal: boolean): string {
  const decided = winnerCount === 1 ? "Only place 1" : `Only the ${winnerCount} winning places`;
  return rehearsal
    ? `${decided} ${winnerCount === 1 ? "comes" : "come"} from this draw's record.`
    : `${decided} ${winnerCount === 1 ? "is" : "are"} decided on chain.`;
}

/** The race show's headline over a decided draw. */
export function replayHeadline(rehearsal: boolean): string {
  return rehearsal ? "The replay of this draw's record." : "The replay of the real result.";
}

/** The race show's standing disclosure under the lanes. */
export function replayDisclosure(rehearsal: boolean): string {
  const tail = rehearsal
    ? "This draw's record decides the result; the replay reproduces that record and nothing else."
    : "The draw itself is decided on chain; this replay reproduces that result and nothing else.";
  return `Pace, style and shape are our design, derived from each Chog's real IPFS traits and capped at +25% for the show. ${tail}`;
}

/** Share card badge, when the card carries a result. */
export function shareBadgeLabel(rehearsal: boolean): string {
  return rehearsal ? "REHEARSAL RESULT" : "REAL DRAW RESULT";
}

/** Share card footer, when the card carries a result. */
export function shareFooterLabel(winnerCount: number, rehearsal: boolean): string {
  if (rehearsal) return "VALUES IN THIS REHEARSAL RECORD";
  return winnerCount > 1 ? "WINNERS AND PRIZE READ FROM THE CHAIN" : "WINNER AND PRIZE READ FROM THE CHAIN";
}

/** The small line under the winner's token id on the share card canvas. */
export function shareSubLabel(name: string | null, hasResult: boolean, rehearsal: boolean): string {
  if (name) return `IPFS NAME: ${name.toUpperCase()}`;
  if (!hasResult) return "";
  return rehearsal ? "WINNER IN THIS DRAW'S RECORD" : "ON-CHAIN WINNER";
}

/* ------------------------------------------------------------------ *
 * Verifier wording, same split: a rehearsal draw's checks read as its
 * own record, never as chain answers.
 * ------------------------------------------------------------------ */

export function verifyRecordTitle(rehearsal: boolean): string {
  return rehearsal ? "What this draw's record holds" : "What the chain records for this race";
}

export function verifyWinnersLine(winners: readonly bigint[], rehearsal: boolean): string {
  const list = winners.map((w) => w.toString()).join(", ") || "none yet";
  return rehearsal ? `Winners in this draw's record: ${list}` : `Winners on chain (winnersOf): ${list}`;
}

export function verifyPrizeLine(potLabel: string, rehearsal: boolean): string {
  return rehearsal
    ? `Prize per winner (as award() would split it): ${potLabel}`
    : `Prize per winner (potPerWinnerOf): ${potLabel}`;
}

export function verifyMatchTitle(rehearsal: boolean): string {
  return rehearsal ? "Recomputed vs this draw's record" : "Recomputed vs the on-chain record";
}

export function verifyRecordedWinnersLine(
  drawId: string,
  winners: readonly bigint[],
  rehearsal: boolean,
): string {
  const list = winners.map((w) => w.toString()).join(", ");
  return rehearsal ? `This draw's record: [${list}]` : `winnersOf(${drawId}) : [${list}]`;
}

export function verifyCareerTitle(tokenId: string, rehearsal: boolean): string {
  return rehearsal
    ? `Trophy rows in this draw's own record for CHOG #${tokenId}`
    : `Trophy inscription in the CareerStore for CHOG #${tokenId}`;
}

export function verdictVerifiedLine(rehearsal: boolean, extraUnavailable: boolean): string {
  return (
    (rehearsal
      ? "VERIFIED: the published seed re-derives this draw's record exactly. Same seed, same winners, for anyone who checks this draw's record."
      : "VERIFIED: the published seed re-derives the on-chain record exactly. Same seed, same winners, for anyone who checks.") +
    (extraUnavailable
      ? " The checks marked NOT AVAILABLE below could not run on this read; everything that could run, passed."
      : "")
  );
}

export function verdictCoreMismatchLine(rehearsal: boolean): string {
  return rehearsal
    ? "MISMATCH: this race's published seed does not reproduce this draw's own record. The steps below say exactly where."
    : "MISMATCH: this race's published seed does not reproduce the chain's own record. The steps below say exactly where.";
}

export const VERDICT_CROSS_MISMATCH_LINE =
  "MISMATCH: the seed re-derives the recorded winners exactly, but a cross-check on this page does not line up. The red card below names the step; treat that part of the record as suspect.";

export const VERDICT_INCOMPLETE_LINE =
  "Not verifiable yet: this race has not published both a seed and a result. Everything on this page is what the chain really holds today.";
