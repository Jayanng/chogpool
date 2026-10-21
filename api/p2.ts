import { verifyRunRecord } from "../web/src/game/runRecord.js";

type Res = { status: (code: number) => Res; json: (payload: unknown) => void };
export default function handler(_req: unknown, res: Res) {
  const check = verifyRunRecord({
    version: 1,
    seed: "probe",
    lengthPx: 100,
    inputs: [],
    reviveAt: null,
    claimed: { score: 0, distance: 0, coins: 0, closeCalls: 0, cleared: false, revived: false },
  });
  return res.status(200).json({ ok: true, probe: "sim", rederived: check.ok });
}
