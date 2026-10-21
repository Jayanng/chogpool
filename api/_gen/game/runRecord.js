// The run record: a run's honest proof. The game writes one at the finish
// line (seed, input tape, claimed numbers) and the Proof page re-runs it
// through the same pure sim. If the numbers recompute, the run is proven:
// no trust in the sender, only in the tape and the seed. This replaces the
// draw-era verifier with the same discipline, aimed at runs.
import { courseOf } from "./course.js";
import { coinsOf, initialRun, revive, step } from "./sim.js";
/** Re-run a record through the sim and report what matched. Pure: the same
 *  record always produces the same verdict. */
export function verifyRunRecord(record) {
    const course = courseOf(record.seed, record.lengthPx);
    const coins = coinsOf(course, record.seed);
    let s = initialRun();
    for (let i = 0; i < record.inputs.length; i++) {
        if (record.reviveAt !== null && i === record.reviveAt)
            s = revive(s);
        s = step(s, record.inputs[i], course, coins);
        if (!s.alive)
            break;
    }
    const cleared = s.distance >= record.lengthPx;
    const checks = [
        {
            label: "Seed accepted",
            ok: typeof record.seed === "string" && record.seed.length > 0,
            detail: `course seed ${record.seed}`,
        },
        {
            label: "Score recomputes",
            ok: s.score === record.claimed.score,
            detail: `recomputed ${s.score}, claimed ${record.claimed.score}`,
        },
        {
            label: "Distance recomputes",
            ok: s.distance === record.claimed.distance,
            detail: `recomputed ${s.distance.toFixed(2)}px, claimed ${record.claimed.distance}px`,
        },
        {
            label: "Coins recomputed",
            ok: s.coins === record.claimed.coins,
            detail: `recomputed ${s.coins}, claimed ${record.claimed.coins}`,
        },
        {
            label: "Close calls recomputed",
            ok: s.closeCalls === record.claimed.closeCalls,
            detail: `recomputed ${s.closeCalls}, claimed ${record.claimed.closeCalls}`,
        },
        {
            label: "Revive flag consistent",
            ok: record.claimed.revived === (record.reviveAt !== null),
            detail: record.reviveAt === null
                ? "no revive in this run"
                : `one revive, after input ${record.reviveAt}`,
        },
        {
            label: "Finish state consistent",
            ok: cleared === record.claimed.cleared,
            detail: cleared ? "the tape reaches the finish line" : "the tape ends before the finish",
        },
    ];
    return { ok: checks.every((c) => c.ok), checks };
}
/** Build the record the game copies at the finish line. */
export function buildRunRecord(args) {
    return {
        version: 1,
        seed: args.seed,
        lengthPx: args.lengthPx,
        inputs: args.inputs.map((i) => ({ jump: i.jump, jumpHeld: i.jumpHeld, duck: i.duck })),
        reviveAt: args.reviveAt,
        claimed: {
            score: args.state.score,
            distance: args.state.distance,
            coins: args.state.coins,
            closeCalls: args.state.closeCalls,
            cleared: args.state.distance >= args.lengthPx,
            revived: args.reviveAt !== null,
        },
    };
}
/** Parse pasted text into a record. Fails honestly and specifically. */
export function parseRunRecord(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return { record: null, error: "That is not JSON. Paste the run record exactly as the game copied it." };
    }
    const r = raw;
    if (!r || typeof r !== "object")
        return { record: null, error: "That is not a run record." };
    if (r.version !== 1)
        return { record: null, error: "Unknown record version. This page verifies version 1 records." };
    if (typeof r.seed !== "string" || r.seed.length === 0)
        return { record: null, error: "The record has no course seed." };
    if (typeof r.lengthPx !== "number" || !Number.isFinite(r.lengthPx) || r.lengthPx <= 0) {
        return { record: null, error: "The record has no valid course length." };
    }
    if (!Array.isArray(r.inputs))
        return { record: null, error: "The record has no input tape." };
    for (const i of r.inputs) {
        if (!i || typeof i.jump !== "boolean" || typeof i.jumpHeld !== "boolean" || typeof i.duck !== "boolean") {
            return { record: null, error: "The input tape is malformed: every input needs jump, jumpHeld and duck." };
        }
    }
    if (r.reviveAt !== null && (typeof r.reviveAt !== "number" || !Number.isInteger(r.reviveAt) || r.reviveAt < 0 || r.reviveAt > r.inputs.length)) {
        return { record: null, error: "The revive marker is malformed." };
    }
    const c = r.claimed;
    if (!c ||
        typeof c.score !== "number" ||
        typeof c.distance !== "number" ||
        typeof c.coins !== "number" ||
        typeof c.closeCalls !== "number" ||
        typeof c.cleared !== "boolean" ||
        typeof c.revived !== "boolean") {
        return { record: null, error: "The record's claimed numbers are missing or malformed." };
    }
    return { record: r, error: null };
}
