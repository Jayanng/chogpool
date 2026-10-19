// Per-button pending tracking for pages with several transaction buttons.
//
// One in-flight transaction marks only its own button. The other buttons keep
// their honest labels and stay usable, because a claim that is waiting on its
// receipt says nothing true about the deposit button next to it. A shared
// "any transaction pending" flag used to put "Sending..." on every button at
// once, which was a lie on all but one of them.

/** Busy flags per button: exactly the in-flight action is true, nothing else. */
export function busyStates<T extends string>(pending: T | null, actions: readonly T[]): Record<T, boolean> {
  const out = {} as Record<T, boolean>;
  for (const action of actions) out[action] = pending === action;
  return out;
}

/** "Sending..." belongs to the button whose action is in flight, and to no other. */
export function isSending(pending: string | null, action: string): boolean {
  return pending === action;
}
