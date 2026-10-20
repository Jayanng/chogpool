// A success modal for every on-chain action. A broadcast is not success: this
// only appears once the receipt is in, and it hands the user a real explorer
// link so "it worked" is checkable, never just claimed. Every write in the app
// runs through runTx, so one modal here covers every transaction.

import { CHAIN } from "../generated/addresses.gen";
import { navigate } from "../lib/router";

type Props = {
  label: string | null;
  txHash: string;
  onClose: () => void;
};

export function TxSuccessModal({ label, txHash, onClose }: Props) {
  return (
    <div
      className="gate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Transaction confirmed"
    >
      <div className="gate-modal tx-success">
        <div className="tx-success__check" aria-hidden="true">
          ✓
        </div>
        <p className="kicker">CONFIRMED ON CHAIN</p>
        <h2 className="gate-title">Done.</h2>
        {label ? <p className="tx-success__summary">{label}</p> : null}
        <p className="gate-body">
          Mined and confirmed on Monad testnet. The link below is the real transaction on the
          explorer: open it and check it yourself.
        </p>
        <p className="tx-success__hash">
          <code>
            {txHash.slice(0, 14)}…{txHash.slice(-12)}
          </code>
          <button
            type="button"
            className="tx-success__copy"
            onClick={() => void navigator.clipboard?.writeText(txHash)}
          >
            Copy
          </button>
        </p>
        <div className="gate-actions">
          {label && label.startsWith("Minted") && (
            <button
              type="button"
              className="gate-btn gate-btn--primary"
              onClick={() => { onClose(); navigate("/play"); }}
            >
              Fund and deposit →
            </button>
          )}
          <a
            className={label && label.startsWith("Minted") ? "gate-btn" : "gate-btn gate-btn--primary"}
            href={`${CHAIN.monadTestnet.explorer}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Explorer ↗
          </a>
          <button type="button" className="gate-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
