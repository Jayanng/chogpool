// Visual-only helpers for the race show: presentation math for the runners,
// the podium ceremony and the prize count-up. Nothing here decides, derives or
// rewords a result; every value it returns is a restatement of one the draw
// already records.

/** How far the runner's nose rides past the checkered column at the finish:
 *  the character breaks the line instead of hiding it. */
export const FINISH_OVERLAP_PX = 22;

/** Runner travel inside its track: progress 0..1 maps to 0 .. (track minus the
 *  runner's own width and the finish overlap), so the runner's nose breaks the
 *  checkered line at exactly 1. The width comes from the track's --runner-w
 *  variable, with the given width as the fallback so art and math cannot
 *  disagree. */
export function runnerLeft(progress: number, runnerWidthPx: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `calc((100% - var(--runner-w, ${runnerWidthPx}px) - ${FINISH_OVERLAP_PX}px) * ${p.toFixed(4)})`;
}

/** Width of the trail the runner drags along, same travel as runnerLeft. */
export function trailWidth(progress: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `calc((100% - ${FINISH_OVERLAP_PX}px) * ${p.toFixed(4)})`;
}

/** 0..1 clock for the podium prize count-up. */
export function countUpT(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  if (elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / durationMs);
}

/** Count from one bigint to another along t in [0, 1]. Waypoints are rough
 *  on purpose (they only ever flash on screen mid-animation) and the value at
 *  t >= 1 is exactly the real number. */
export function countUpValue(from: bigint, to: bigint, t: number): bigint {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const span = to - from;
  return from + BigInt(Math.floor(Number(span) * t));
}

/** "1ST", "2ND", "3RD", "4TH" for a podium rank badge. Place numbers are the
 *  winning places the draw decides. */
export function ordinalPlace(place: number): string {
  const n = Math.max(1, Math.floor(place));
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "TH" : n % 10 === 1 ? "ST" : n % 10 === 2 ? "ND" : n % 10 === 3 ? "RD" : "TH";
  return `${n}${suffix}`;
}
