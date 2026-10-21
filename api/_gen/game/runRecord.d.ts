import { type Input } from "./sim.js";
export type RunRecord = {
    version: 1;
    /** the course seed the run happened on */
    seed: string;
    /** the course length in px the run was scored against */
    lengthPx: number;
    /** the exact inputs pressed, frame by frame */
    inputs: Array<{
        jump: boolean;
        jumpHeld: boolean;
        duck: boolean;
    }>;
    /** the tape index where the one revive happened, null when unused */
    reviveAt: number | null;
    claimed: {
        score: number;
        distance: number;
        coins: number;
        closeCalls: number;
        cleared: boolean;
        revived: boolean;
    };
};
export type RunCheck = {
    label: string;
    ok: boolean;
    detail: string;
};
export type RunVerification = {
    ok: boolean;
    checks: RunCheck[];
};
/** Re-run a record through the sim and report what matched. Pure: the same
 *  record always produces the same verdict. */
export declare function verifyRunRecord(record: RunRecord): RunVerification;
/** Build the record the game copies at the finish line. */
export declare function buildRunRecord(args: {
    seed: string;
    lengthPx: number;
    state: {
        score: number;
        distance: number;
        coins: number;
        closeCalls: number;
    };
    inputs: Input[];
    reviveAt: number | null;
}): RunRecord;
/** Parse pasted text into a record. Fails honestly and specifically. */
export declare function parseRunRecord(text: string): {
    record: RunRecord;
    error: null;
} | {
    record: null;
    error: string;
};
