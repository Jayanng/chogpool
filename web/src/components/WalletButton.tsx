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
