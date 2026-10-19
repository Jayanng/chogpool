// The gate modal: what a wallet without a Chog sees instead of the app. It is a
// door, not a scolding. Minting a Chog is the one pass in, and it happens right
// here in the app: no sending anyone out to a marketplace mid-demo. The Chog you
// mint on testnet is a Test Chog and stays labeled as one.

import { navigate } from "../lib/router";
import { CHOG_MARKETPLACE_URL } from "../lib/gate";

export function GateModal() {
  return (
    <div className="gate-overlay" role="dialog" aria-modal="true" aria-label="A Chog is required">
      <div className="gate-modal">
        <p className="kicker">THE ONLY WAY IN</p>
        <h2 className="gate-title">You need a Chog to race.</h2>
        <p className="gate-body">
          This app is for Chog holders. Mint one right here to unlock the full experience.
        </p>
        <div className="gate-actions">
          <button type="button" className="gate-btn gate-btn--primary" onClick={() => navigate("/mint")}>
            Mint a Chog
          </button>
        </div>
        <p className="gate-note gate-note--only">
          This is the only pass into the app. Mint a Chog and you are through.
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
