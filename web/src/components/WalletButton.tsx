import { useEffect, useState } from "react";
import { Badge, Button } from "@chogpool/ui";
import {
  chainLabel,
  connectWallet,
  detectWallet,
  onWalletChange,
  shortAddress,
  switchToTestnet,
  type WalletState,
} from "../lib/wallet";
import { GAME_LABELS } from "../types/game";

type Phase = "idle" | "connecting" | "connected" | "error";

/** Wallet entry point. Never implies a wallet is connected when it is not. */
export function WalletButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [error, setError] = useState("");
  const detected = detectWallet();

  useEffect(() => onWalletChange(() => {
    setWallet(null);
    setPhase("idle");
  }), []);

  async function connect() {
    setPhase("connecting");
    setError("");
    try {
      const state = await connectWallet();
      setWallet(state);
      setPhase("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
      setPhase("error");
    }
  }

  if (!detected.present) {
    return (
      <div className="wallet-slot">
        <Badge tone="danger">NO WALLET</Badge>
        <span className="wallet-note">{detected.label}</span>
      </div>
    );
  }

  if (phase === "connected" && wallet) {
    return (
      <div className="wallet-slot">
        <Badge tone="lime">{chainLabel(wallet.chainId)}</Badge>
        <span className="wallet-note">{shortAddress(wallet.address)}</span>
        {wallet.chainId !== 10143 && (
          <Button variant="outline" onClick={() => void switchToTestnet(wallet.walletClient).then(() => setWallet({ ...wallet, chainId: 10143 })).catch((e) => setError(e instanceof Error ? e.message : "Switch failed."))}>
            Switch to Play network
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-slot">
      <Button variant="outline" onClick={() => void connect()} disabled={phase === "connecting"}>
        {phase === "connecting" ? "Connecting…" : "Connect wallet"}
      </Button>
      {phase === "error" && <span className="wallet-note wallet-note--error">{error}</span>}
      {!error && <span className="wallet-note">{GAME_LABELS.readNetwork} · {GAME_LABELS.playNetwork}</span>}
    </div>
  );
}
