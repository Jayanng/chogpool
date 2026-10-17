// The connect gate: what a visitor sees before a wallet is connected. Nothing in
// the app moves without a wallet, so the door here is simply "connect one". No
// nav, no app, just this prompt. After connecting, the Chog gate takes over.

type Props = {
  onConnect: () => void;
};

export function ConnectGateModal({ onConnect }: Props) {
  return (
    <div
      className="gate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet first"
    >
      <div className="gate-modal">
        <p className="kicker">BEFORE YOU ENTER</p>
        <h2 className="gate-title">Connect a wallet first.</h2>
        <p className="gate-body">
          Chog Track runs on your wallet: deposits, the race, and your career all live on chain.
          Connect one to step inside.
        </p>
        <div className="gate-actions">
          <button type="button" className="gate-btn gate-btn--primary" onClick={onConnect}>
            Connect wallet
          </button>
        </div>
        <p className="gate-note gate-note--only">
          Connecting takes a moment, and nothing moves without your say.
        </p>
      </div>
    </div>
  );
}
