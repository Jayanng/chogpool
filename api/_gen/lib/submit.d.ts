import type { RunRecord } from "../game/runRecord.js";
export type SubmitOutcome = {
    status: "recorded";
    detail: string;
    tx: string | null;
} | {
    status: "already";
    detail: string;
} | {
    status: "rejected";
    detail: string;
} | {
    status: "error";
    detail: string;
};
/** Parse an untrusted body into a submission. Pure, and tested as such. */
export declare function parseSubmission(body: unknown): {
    ok: true;
    tokenId: bigint;
    record: RunRecord;
} | {
    ok: false;
    error: string;
};
/** Send a finished run to the recorder. The chain has the last word. */
export declare function submitRun(tokenId: bigint, record: RunRecord): Promise<SubmitOutcome>;
