// Broadcast layer for the race show: positions, gaps and a commentary ticker.
//
// Presentation only. Every number here is a restatement of the replay the
// chain already decided: positions rank the curves the replay walks, the
// ticker narrates lead changes those curves contain, and gaps are differences
// between two progress values. Nothing can disagree with the result because
// nothing here computes one. Deterministic in, deterministic out.

export type CommentaryEvent = {
  /** Winner-progress fraction (0..1) at which this line appears. */
  at: number;
  text: string;
};

export type LaneCurve = {
  tokenId: bigint;
  /** Finish rank from the chain's winner list and payout order (0 = winner). */
  rank: number;
  /** Cumulative progress at the end of each segment. */
  progressCurve: number[];
};

/** Live positions (1 = front) from the progress values on screen right now.
 *  Ties break by the chain's own finish order, so equal frames are stable. */
export function positionMap(
  entries: Array<{ tokenId: string; progress: number }>,
  finishOrder: string[],
): Record<string, number> {
  const order = (id: string) => {
    const i = finishOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sorted = [...entries].sort((a, b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    return order(a.tokenId) - order(b.tokenId);
  });
  const out: Record<string, number> = {};
  sorted.forEach((e, i) => {
    out[e.tokenId] = i + 1;
  });
  return out;
}

/** The gap readout: the leader says LEADING, everyone else says how far back,
 *  to one decimal of a percent (clamped so it can never read "100% back"
 *  while still on screen). */
export function gapLabel(leaderProgress: number, myProgress: number): string {
  const gap = leaderProgress - myProgress;
  if (gap <= 0) return "LEADING";
  const pct = Math.min(99.9, Math.round(gap * 1000) / 10);
  return `${pct.toFixed(1)}% BACK`;
}

function leaderAt(lanes: LaneCurve[], segment: number): LaneCurve | null {
  let best: LaneCurve | null = null;
  for (const lane of lanes) {
    const p = lane.progressCurve[segment] ?? 0;
    const b = best ? (best.progressCurve[segment] ?? 0) : -1;
    if (best === null || p > b || (p === b && lane.rank < best.rank)) best = lane;
  }
  return best;
}

/** The margin the show stamps on the photo finish: the winner's finish time
 *  minus the runner-up's, as a percent of the race. A restatement of two
 *  finishTime values the replay already carries; rank order is the chain's,
 *  so a presentation gap can never flip who won. */
export function marginOf(
  lanes: Array<{ tokenId: bigint; rank: number; finishTime: number }>,
): { winner: bigint; runnerUp: bigint; marginPct: number } | null {
  const sorted = [...lanes].sort((a, b) => a.rank - b.rank || a.finishTime - b.finishTime);
  if (sorted.length < 2) return null;
  const [w, r] = sorted;
  const pct = Math.max(0, (r.finishTime - w.finishTime) * 100);
  return { winner: w.tokenId, runnerUp: r.tokenId, marginPct: Math.round(pct * 100) / 100 };
}

export function marginLabel(margin: { marginPct: number } | null): string {
  if (!margin) return "";
  return `WON BY ${margin.marginPct.toFixed(1)}%`;
}

/** The commentary the show narrates: one line per moment the curves actually
 *  contain (lead changes, the stretch, the flag). Sorted by the winner's
 *  progress so the ticker can pick the latest line on screen at any frame. */
export function commentaryOf(lanes: LaneCurve[], winner: bigint, segments: number): CommentaryEvent[] {
  const label = (id: bigint) => `CHOG #${id.toString()}`;
  const winnerLane = lanes.find((l) => l.tokenId === winner) ?? lanes[0];
  const events: CommentaryEvent[] = [];
  if (!winnerLane || segments <= 0) return events;

  const winnerAt = (i: number) => winnerLane.progressCurve[Math.min(i, winnerLane.progressCurve.length - 1)] ?? 1;
  events.push({ at: 0, text: `THE GATES ARE OPEN · ${lanes.length} RACERS IN THE BOOK` });

  let leader = leaderAt(lanes, 0);
  let changes = 0;
  for (let i = 1; i < segments; i++) {
    const now = leaderAt(lanes, i);
    if (now && leader && now.tokenId !== leader.tokenId) {
      changes++;
      events.push({ at: winnerAt(i), text: `${label(now.tokenId)} TAKES THE LEAD` });
    }
    leader = now;
  }

  const mid = leaderAt(lanes, 0);
  if (changes === 0 && mid) {
    events.push({ at: winnerAt(Math.floor(segments / 2)), text: `${label(mid.tokenId)} LEADS WIRE TO WIRE` });
  }
  events.push({ at: winnerAt(Math.floor(segments * 0.8)), text: "INTO THE STRETCH" });
  events.push({ at: 1, text: `${label(winner)} WINS THE FLAG` });
  return events.sort((a, b) => a.at - b.at);
}
