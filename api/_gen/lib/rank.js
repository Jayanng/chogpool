// THE RANKING RULE, in one place. The site's standings and the recorder's
// board endpoint both rank by this: highest score first, ties broken by
// tokenId so the order never wobbles. And the honesty rule travels with it:
// the contract's participantCount is the truth of how many runs exist, and a
// reader whose window could not reach the week's opening says so.
/** Sort by score, then tokenId. Pure and tested as such. */
export function rankRuns(rows) {
    return [...rows].sort((a, b) => {
        if (a.score === b.score)
            return a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0;
        return a.score > b.score ? -1 : 1;
    });
}
/**
 * The one line that says what the list is. Never "full standings" when the
 * scan could not reach the week's opening.
 */
export function standingsNote(s) {
    if (s.recorded === 0)
        return "No runs recorded on chain for this week yet.";
    if (s.covered)
        return `All ${s.recorded} recorded run${s.recorded === 1 ? "" : "s"}, ranked by score.`;
    return `Showing ${s.rows.length} of ${s.recorded} recorded runs. Older runs are outside this reader's window.`;
}
