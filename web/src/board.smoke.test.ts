import { describe, expect, it } from "vitest";
import handler from "../../api/board";

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

describe("board handler, live chain", () => {
  it("returns the week's board or an honest state", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res);
    console.log("BOARD RESPONSE:", JSON.stringify(res.payload).slice(0, 400));
    expect([200]).toContain(res.code);
  }, 60_000);
});
