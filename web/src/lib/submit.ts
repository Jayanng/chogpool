// THE RUN-TO-CHAIN PATH. A finished run is re-derived and submitted in one
// step: the page POSTs the run record to the recorder endpoint, which checks
// the tape through the same pure sim before anything goes on chain. The
// player never waits on a keeper: the run that just ended is the run that
// ranks. Responses always say which of the real outcomes happened, never a
// hopeful "sent".

import type { RunRecord } from "../game/runRecord.js";

export type SubmitOutcome =
  | { status: "recorded"; detail: string; tx: string | null }
  | { status: "already"; detail: string }
  | { status: "rejected"; detail: string }
  | { status: "error"; detail: string };

/** Parse an untrusted body into a submission. Pure, and tested as such. */
export function parseSubmission(body: unknown):
  | { ok: true; tokenId: bigint; record: RunRecord }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Body must be an object." };
  const b = body as Record<string, unknown>;

  const rawId = b.tokenId;
  const tokenId = typeof rawId === "string" || typeof rawId === "number" ? BigInt(rawId) : typeof rawId === "bigint" ? rawId : null;
  if (tokenId === null) return { ok: false, error: "tokenId is missing." };
  if (tokenId < 1n || tokenId > 1969n) return { ok: false, error: "tokenId must be between 1 and 1,969." };

  const record = b.record;
  if (typeof record !== "object" || record === null) return { ok: false, error: "record is missing." };
  const r = record as Record<string, unknown>;
  if (r.version !== 1) return { ok: false, error: "Unsupported record version." };
  if (typeof r.seed !== "string" || r.seed.length === 0) return { ok: false, error: "record.seed is missing." };
  if (!Array.isArray(r.inputs)) return { ok: false, error: "record.inputs is missing." };
  const claimed = r.claimed as Record<string, unknown> | undefined;
  if (typeof claimed !== "object" || claimed === null) return { ok: false, error: "record.claimed is missing." };
  for (const field of ["score", "coins"] as const) {
    const v = claimed[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return { ok: false, error: `record.claimed.${field} must be a non-negative number.` };
    }
  }
  if (typeof claimed.revived !== "boolean") return { ok: false, error: "record.claimed.revived must be a boolean." };

  return { ok: true, tokenId, record: record as RunRecord };
}

/** Send a finished run to the recorder. The chain has the last word. */
export async function submitRun(tokenId: bigint, record: RunRecord): Promise<SubmitOutcome> {
  try {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId: tokenId.toString(), record }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      detail?: string;
      tx?: string | null;
    };
    const detail = body.detail ?? (res.ok ? "Recorded." : "The recorder refused the run.");
    if (body.status === "recorded") return { status: "recorded", detail, tx: body.tx ?? null };
    if (body.status === "already") return { status: "already", detail };
    if (body.status === "rejected") return { status: "rejected", detail };
    return { status: "error", detail };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "The recorder could not be reached.",
    };
  }
}
