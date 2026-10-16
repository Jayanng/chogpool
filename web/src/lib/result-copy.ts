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

/** Share card line for where the prize came from. */
export function splitCanvasLabel(winners: readonly bigint[], zeroPot = false): string {
  if (zeroPot) return "The pot split to zero per winner";
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
