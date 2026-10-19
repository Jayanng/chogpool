// The public Monad testnet RPC caps callers at 15 requests per second and
// answers over budget with HTTP 429 carrying JSON-RPC error -32011 ("requests
// limited to 15/sec"). A cold verifier walk fans out around 54 reads at once,
// and the shared read client had no queue in front of it, so bursts came back
// rate-limited and honest checks printed NOT AVAILABLE for data the chain has.
//
// This module is that queue and nothing else: it spaces request starts, keeps
// a small number of requests in flight, and retries a rate-limited answer a
// couple of times with a short backoff. A request that is still rate-limited
// after the retries is returned as it came, so the caller reports the real
// failure instead of a manufactured answer. Dependency-free on purpose.

/** The JSON-RPC error code the Monad RPC answers with when a caller is over budget. */
export const RATE_LIMIT_RPC_CODE = -32011;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ThrottleOptions = {
  /** Minimum milliseconds between request starts. Default 110, about 9 rps. */
  minIntervalMs?: number;
  /** Maximum requests in flight at once. Default 3. */
  maxConcurrent?: number;
  /** Extra attempts after a rate-limited answer. Default 2. */
  retries?: number;
  /** Backoff before the first retry; doubles on each further retry. Default 250. */
  backoffMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when the answer says the caller is over the RPC's rate budget, either
 *  as HTTP 429 or as a body carrying error code -32011 (the Monad RPC writes
 *  it top-level in 429 bodies and under "error" in JSON-RPC answers). */
export function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  try {
    const parsed = JSON.parse(body) as { code?: number; error?: { code?: number } } | null;
    return parsed?.code === RATE_LIMIT_RPC_CODE || parsed?.error?.code === RATE_LIMIT_RPC_CODE;
  } catch {
    return false;
  }
}

/**
 * Hands out request slots: at most one start per minIntervalMs and at most
 * maxConcurrent in flight. Waiters wake in arrival order.
 */
class StartGate {
  private inFlight = 0;
  private nextSlotAt = 0;
  private waiting: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxConcurrent: number,
  ) {}

  take(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.pump();
    });
  }

  release(): void {
    this.inFlight -= 1;
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrent && this.waiting.length > 0) {
      const now = Date.now();
      if (now < this.nextSlotAt) {
        this.arm(this.nextSlotAt - now);
        return;
      }
      this.nextSlotAt = now + this.minIntervalMs;
      this.inFlight += 1;
      const next = this.waiting.shift();
      next?.();
    }
  }

  private arm(ms: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }
}

/** A fetch that stays inside the RPC's rate budget and retries rate-limited
 *  answers. Everything else passes through untouched. */
export function throttledFetch(fetchImpl: FetchLike, options: ThrottleOptions = {}): FetchLike {
  const minIntervalMs = options.minIntervalMs ?? 110;
  const maxConcurrent = options.maxConcurrent ?? 3;
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 250;
  const gate = new StartGate(minIntervalMs, maxConcurrent);

  return async (input, init) => {
    let attempt = 0;
    for (;;) {
      await gate.take();
      let response: Response;
      try {
        response = await fetchImpl(input, init);
      } finally {
        gate.release();
      }
      // Only JSON-RPC answers can carry a rate limit; anything else is the
      // caller's to read.
      if (response.status !== 429 && !response.ok) return response;
      const body = await response.text();
      const replay = () => new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      if (!isRateLimited(response.status, body)) return replay();
      // Out of retries: hand back the real rate-limited answer. A failed read
      // is not an answer, and the UI says so honestly.
      if (attempt >= retries) return replay();
      attempt += 1;
      await sleep(backoffMs * attempt);
    }
  };
}

/** The shared read transport: throttled fetch straight at global fetch. */
export function rpcFetch(options: ThrottleOptions = {}): FetchLike {
  return throttledFetch((input, init) => globalThis.fetch(input, init), options);
}
