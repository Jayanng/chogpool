// THE RANKING RULE, in one place. The site's standings and the recorder's
// board endpoint both rank by this: highest score first, ties broken by
// tokenId so the order never wobbles. And the honesty rule travels with it:
// the contract's participantCount is the truth of how many runs exist, and a
// reader whose window could not reach the week's opening says so.

export type StandingRow = {
  tokenId: bigint;
  score: bigint;
  coins: bigint;
  revived: boolean;
};

export type RankedBoard = {
  rows: StandingRow[];
  /** participantCount from the contract: how many runs are recorded on chain */
  recorded: number;
  /** true when the scan reached the week's opening, so rows is the full list */
  covered: boolean;
};

/** Sort by score, then tokenId. Pure and tested as such. */
export function rankRuns(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (a.score === b.score) return a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0;
    return a.score > b.score ? -1 : 1;
  });
}

/**
 * The one line that says what the list is. Never "full standings" when the
 * scan could not reach the week's opening. Honest without the plumbing.
 */
export function standingsNote(s: RankedBoard): string {
  if (s.recorded === 0) return "No runs recorded yet this week.";
  if (s.covered) return `All ${s.recorded} recorded run${s.recorded === 1 ? "" : "s"}, live from the chain.`;
  return `${s.rows.length} of ${s.recorded} recorded runs shown, live from the chain.`;
}
