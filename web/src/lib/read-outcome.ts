// The three honest states of one chain read.
//
// A failed read is not an answer (the verifier keeps the same rule in
// web/src/verify/verifyDraw.ts): it is never folded into "nothing there", and
// no surface may render it as a fact about the chain. Every read whose result
// is shown maps through here first.

/** A chain read's outcome: the value when the read answered with one, a
 *  genuine absence the read itself confirmed, or a read that did not answer. */
export type ReadOutcome<T> =
  | { state: "value"; value: T }
  | { state: "absent" }
  | { state: "failed" };

/** Pure three-state mapping from one settled read. `isAbsent` decides when an
 *  answered value means the chain holds nothing (a zero address, a badge of
 *  0). A rejected read is always "failed", never "absent". */
export function readOutcome<T>(
  settled: PromiseSettledResult<T>,
  isAbsent: (value: T) => boolean,
): ReadOutcome<T> {
  if (settled.status === "rejected") return { state: "failed" };
  return isAbsent(settled.value) ? { state: "absent" } : { state: "value", value: settled.value };
}
