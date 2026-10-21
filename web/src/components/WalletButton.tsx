import { useState } from "react";
import { Badge, Button } from "@chogpool/ui";
import { chainLabel, shortAddress } from "../lib/wallet";
import { useWallet } from "../lib/useWallet";

/**
 * Wallet entry point. Never implies a wallet is connected when it is not, and
 * reads the shared wallet store so this header and every connect gate on the
 * page can never disagree about who is connected.
 */
export function WalletButton() {
  const wallet = useWallet();
  const [note, setNote] = useState("");

  if (!wallet.walletPresent) {
    return (
      <div className="wallet-slot">
        <Button variant="outline" onClick={() => setNote("No browser wallet detected. Install MetaMask or Rabby to connect.")}>
          Connect wallet
        </Button>
        {note && <span className="wallet-note wallet-note--error">{note}</span>}
      </div>
    );
  }

  if (wallet.connected && wallet.address !== null && wallet.chainId !== null) {
    return (
      <div className="wallet-slot">
        <Badge tone="lime">{chainLabel(wallet.chainId)}</Badge>
        <span className="wallet-note">{shortAddress(wallet.address)}</span>
        <button
          type="button"
          className="wallet-disconnect"
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
          onClick={() => wallet.disconnect()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 4v7" />
            <path d="M7.5 6.8a7 7 0 1 0 9 0" />
          </svg>
        </button>
        {wallet.onWrongChain && (
          <Button
            variant="outline"
            onClick={() => void wallet.switchNetwork().catch((e) => setNote(e instanceof Error ? e.message : "Switch failed."))}
          >
            Switch to Play network
          </Button>
        )}
        {note && <span className="wallet-note wallet-note--error">{note}</span>}
      </div>
    );
  }

  return (
    <div className="wallet-slot">
      <Button variant="outline" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
        {wallet.connecting ? "Connecting…" : "Connect wallet"}
      </Button>
      {wallet.connectError && <span className="wallet-note wallet-note--error">{wallet.connectError}</span>}
    </div>
  );
}
