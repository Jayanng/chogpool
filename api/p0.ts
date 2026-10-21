type Res = { status: (code: number) => Res; json: (payload: unknown) => void };
export default function handler(_req: unknown, res: Res) {
  return res.status(200).json({ ok: true, probe: "no-imports" });
}
