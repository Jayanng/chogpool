import { describe, expect, it } from "vitest";
import handler from "../../api/runs";
import { courseOf } from "./game/course";
import { coinsOf, initialRun, step } from "./game/sim";
import { buildRunRecord } from "./game/runRecord";

type Res = { code: number; payload: unknown; status(c: number): Res; json(o: unknown): void };
function makeRes(): Res {
  const res: Res = {
    code: 0,
    payload: null,
    status(c: number) {
      res.code = c;
      return res;
    },
    json(o: unknown) {
      res.payload = o;
    },
  };
  return res;
}

describe("the recorder handler", () => {
  it("refuses anything but POST", async () => {
    const res = makeRes();
    await handler({ method: "GET" }, res);
    expect(res.code).toBe(405);
  });

  it("refuses a forged record before any key or chain is touched", async () => {
    const res = makeRes();
    const forged = {
      tokenId: "20",
      record: {
        version: 1,
        seed: "forged-seed",
        lengthPx: 6000,
        inputs: [{ jump: false, jumpHeld: false, duck: false }],
        reviveAt: null,
        claimed: { score: 999999, distance: 6000, coins: 500, closeCalls: 0, cleared: true, revived: false },
      },
    };
    await handler({ method: "POST", body: forged }, res);
    expect(res.code).toBe(400);
    expect(JSON.stringify(res.payload)).toContain("did not re-derive");
  });

  it("says the recorder has no key rather than pretending to record", async () => {
    const saved = process.env.GAME_AUTHORITY_KEY;
    delete process.env.GAME_AUTHORITY_KEY;
    const res = makeRes();
    // A record built by the real sim, so it genuinely re-derives.
    const seed = "smoke";
    const lengthPx = 6000;
    const course = courseOf(seed, lengthPx);
    const coins = coinsOf(course, seed);
    const inputs = [{ jump: false, jumpHeld: false, duck: false }];
    let state = initialRun();
    for (const input of inputs) state = step(state, input, course, coins);
    const record = buildRunRecord({ seed, lengthPx, state, inputs, reviveAt: null });
    await handler({ method: "POST", body: { tokenId: "20", record } }, res);
    if (saved !== undefined) process.env.GAME_AUTHORITY_KEY = saved;
    expect(res.code).toBe(503);
    expect(JSON.stringify(res.payload)).toContain("no key configured");
  });
});
