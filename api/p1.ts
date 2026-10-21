import { parseAbi } from "viem";

type Res = { status: (code: number) => Res; json: (payload: unknown) => void };
export default function handler(_req: unknown, res: Res) {
  const abi = parseAbi(["function ping() view returns (uint256)"]);
  return res.status(200).json({ ok: true, probe: "viem", abiItems: abi.length });
}
