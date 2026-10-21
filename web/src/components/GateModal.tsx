// The gate modal: what a wallet without a Chog sees instead of the app. It is a
// door, not a scolding. Minting a Chog is the one pass in, and it happens right
// here in the app: no sending anyone out to a marketplace mid-demo. The Chog you
// mint on testnet is a Test Chog and stays labeled as one.

import { useEffect } from "react";
import { navigate } from "../lib/router";
import { CHOG_MARKETPLACE_URL } from "../lib/gate";

export function GateModal() {
  // The gate is dismissable: clicking outside it or pressing Escape leaves for
  // the landing. The modal itself swallows its own clicks so only the backdrop
  // dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="gate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="A Chog is required"
      onClick={() => navigate("/")}
    >
      <div className="gate-modal" onClick={(e) => e.stopPropagation()}>
        <p className="kicker">THE ONLY WAY IN</p>
        <h2 className="gate-title">You need a Chog to race.</h2>
        <p className="gate-body">
          This app is for Chog holders. Mint one right here to unlock the full experience.
        </p>
        <div className="gate-actions">
          <button type="button" className="gate-btn gate-btn--primary" onClick={() => navigate("/mint")}>
            Mint a Chog
          </button>
          <button type="button" className="gate-btn" onClick={() => navigate("/")}>
            Back to the landing
          </button>
        </div>
        <p className="gate-note gate-note--only">
          This is the only pass into the app. Mint a Chog and you are through. Tap outside to go back.
        </p>
        <p className="gate-note">
          What you mint here is a Test Chog: minted on testnet with test funds and always marked as
          Test.
        </p>
        {CHOG_MARKETPLACE_URL ? (
          <p className="gate-foot">
            Real Chogs trade on{" "}
            <a href={CHOG_MARKETPLACE_URL} target="_blank" rel="noreferrer">
              OpenSea
            </a>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
