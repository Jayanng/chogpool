// Per-button pending states. One transaction in flight marks only its own
// button, so the others keep their honest labels and stay usable. A shared
// "any transaction pending" flag once put "Sending..." on every money button
// at once, which was a lie on all but one of them.

import { describe, expect, it } from "vitest";
import { busyStates, isSending } from "./tx-pending";

const MONEY_ACTIONS = ["claim", "swap", "approve", "deposit", "withdraw"] as const;
const MINT_ACTIONS = ["lookup", "sign", "mint", "test-drive"] as const;

describe("one transaction marks only its own button", () => {
  it("marks the in-flight action and no other", () => {
    expect(busyStates("swap", MONEY_ACTIONS)).toEqual({
      claim: false,
      swap: true,
      approve: false,
      deposit: false,
      withdraw: false,
    });
  });

  it("marks nothing while no transaction is in flight", () => {
    expect(busyStates(null, MONEY_ACTIONS)).toEqual({
      claim: false,
      swap: false,
      approve: false,
      deposit: false,
      withdraw: false,
    });
  });

  it("marks nothing when the pending action is not one of these buttons", () => {
    for (const flag of Object.values(busyStates("harvest", MONEY_ACTIONS))) expect(flag).toBe(false);
    for (const flag of Object.values(busyStates("swap", MINT_ACTIONS))) expect(flag).toBe(false);
  });

  it("gives every action exactly its own turn", () => {
    for (const action of MONEY_ACTIONS) {
      const flags = busyStates(action, MONEY_ACTIONS);
      for (const other of MONEY_ACTIONS) expect(flags[other]).toBe(other === action);
    }
  });

  it("sends on the in-flight button only", () => {
    for (const action of MONEY_ACTIONS) {
      for (const other of MONEY_ACTIONS) expect(isSending(action, other)).toBe(action === other);
    }
    for (const action of MONEY_ACTIONS) expect(isSending(null, action)).toBe(false);
    expect(isSending("test-drive", "mint")).toBe(false);
  });
});
