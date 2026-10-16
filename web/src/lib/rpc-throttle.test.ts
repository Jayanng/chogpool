// The read queue in front of the public RPC. The contract these tests pin:
// request starts stay inside the rate budget, no more than maxConcurrent are
// in flight, a rate-limited answer (HTTP 429 or JSON-RPC -32011) is retried
// with backoff, and anything else passes through exactly as it came.

import { describe, expect, it } from "vitest";
import { isRateLimited, throttledFetch, type FetchLike } from "./rpc-throttle";

function json(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

const OK_BODY = '{"jsonrpc":"2.0","id":1,"result":"0x1"}';
const LIMITED_BODY = '{"code":-32011,"message":"requests limited to 15/sec"}';

describe("the throttled fetch keeps the read burst inside the RPC's budget", () => {
  it("spaces request starts by at least minIntervalMs", async () => {
    const starts: number[] = [];
    const fetchImpl: FetchLike = async () => {
      starts.push(Date.now());
      return json(200, OK_BODY);
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 40, maxConcurrent: 3 });
    await Promise.all([wrapped("/rpc"), wrapped("/rpc"), wrapped("/rpc"), wrapped("/rpc")]);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(35); // timer slop tolerance
    }
  });

  it("never runs more than maxConcurrent requests at once", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return json(200, OK_BODY);
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 1, maxConcurrent: 2 });
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => wrapped("/rpc")));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it("retries an HTTP 429 rate limit and returns the eventual good answer", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls <= 2 ? json(429, LIMITED_BODY) : json(200, OK_BODY);
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 1, backoffMs: 5 });
    const response = await wrapped("/rpc");
    expect(calls).toBe(3);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(OK_BODY);
  });

  it("retries a JSON-RPC -32011 error body that arrives with HTTP 200", async () => {
    let calls = 0;
    const rpcErrorBody = '{"jsonrpc":"2.0","id":1,"error":{"code":-32011,"message":"requests limited to 15/sec"}}';
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1 ? json(200, rpcErrorBody) : json(200, OK_BODY);
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 1, backoffMs: 5 });
    const response = await wrapped("/rpc");
    expect(calls).toBe(2);
    expect(await response.text()).toBe(OK_BODY);
  });

  it("hands back the real rate-limited answer once retries run out", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json(429, LIMITED_BODY);
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 1, retries: 1, backoffMs: 5 });
    const response = await wrapped("/rpc");
    expect(calls).toBe(2); // first try plus one retry, then honest failure
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(LIMITED_BODY);
  });

  it("passes every other answer through untouched and unretried", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json(500, "boom");
    };
    const wrapped = throttledFetch(fetchImpl, { minIntervalMs: 1, backoffMs: 5 });
    const response = await wrapped("/rpc");
    expect(calls).toBe(1);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("boom");
  });

  it("classifies rate limits only as 429 or error code -32011", () => {
    expect(isRateLimited(429, "")).toBe(true);
    // Both body shapes the Monad RPC writes: top-level code in 429 answers,
    // nested under "error" in JSON-RPC answers.
    expect(isRateLimited(200, LIMITED_BODY)).toBe(true);
    expect(isRateLimited(200, '{"jsonrpc":"2.0","id":1,"error":{"code":-32011,"message":"requests limited to 15/sec"}}')).toBe(true);
    expect(isRateLimited(200, OK_BODY)).toBe(false);
    expect(isRateLimited(200, '{"jsonrpc":"2.0","error":{"code":-32000,"message":"other"}}')).toBe(false);
    expect(isRateLimited(200, "not json")).toBe(false);
    expect(isRateLimited(500, "boom")).toBe(false);
  });
});
