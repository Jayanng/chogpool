// Which Chog a wallet brought to the track. The mirror contract has no token
// enumeration and the RPC only allows 100-block log ranges, so the mint records
// the id it mirrored and the deposit form picks it up. This is a convenience,
// not a truth: the deposit page still re-reads the mirror owner on chain and
// refuses a Chog the wallet does not hold, so a wrong or stale id can never turn
// into a reverting transaction.

const KEY_PREFIX = "chogpool:mychog:";

const MAX_TOKEN_ID = 1969n;

function keyFor(account: string): string {
  return KEY_PREFIX + account.toLowerCase();
}

export function saveMyChog(account: string, tokenId: bigint): void {
  try {
    localStorage.setItem(keyFor(account), tokenId.toString());
  } catch {
    // A browser with storage off simply loses the convenience, nothing more.
  }
}

export function loadMyChog(account: string): bigint | null {
  try {
    const raw = localStorage.getItem(keyFor(account));
    if (raw && /^\d+$/.test(raw)) {
      const id = BigInt(raw);
      if (id >= 1n && id <= MAX_TOKEN_ID) return id;
    }
  } catch {
    // fall through to "unknown"
  }
  return null;
}
