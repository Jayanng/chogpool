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
export declare function rankRuns(rows: StandingRow[]): StandingRow[];
/**
 * The one line that says what the list is. Never "full standings" when the
 * scan could not reach the week's opening.
 */
export declare function standingsNote(s: RankedBoard): string;
