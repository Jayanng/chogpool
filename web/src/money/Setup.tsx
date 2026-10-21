// Set me up: the one guided path from an empty wallet to being entered.
// Every step is a real transaction the player signs, run in order with
// honest status per step: what is being sent, what it did, what failed.
// Nothing is skipped silently and nothing claims success without a receipt.

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { Badge, Button, Card, Panel, Stat } from "@chogpool/ui";
import { mirrorAbi } from "../lib/abi";
import {
  approveQuoteForRouter,
  claimStableFaucet,
  claimTestChog,
  formatUsdc,
  quoteQuoteToAsset,
  readQuoteBalance,
  readQuoteRouterAllowance,
  readStableFaucetReadyAt,
  readTestChogReadyAt,
  readUsdcBalance,
  swapQuoteToAsset,
} from "../lib/money";
import { lookupChog } from "../lib/mirror";
import { saveMyChog, loadMyChog } from "../lib/mychog";
import { navigate } from "../lib/router";
import { useWallet } from "../lib/useWallet";
import { testnetReadClient } from "../lib/wallet";
import { DEPLOYED } from "../generated/addresses.gen";

type StepKey = "faucet" | "swap" | "testchog" | "mint" | "enter";
type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed";

type Step = {
  key: StepKey;
  label: string;
  what: string;
  status: StepStatus;
  note: string;
};

const INITIAL_STEPS: Step[] = [
  { key: "faucet", label: "Claim test funds", what: "Claims the faucet's quote token. Test funds only.", status: "waiting", note: "" },
  { key: "swap", label: "Swap into USDC", what: "Swaps the faucet quote into USDC, what the pool accepts.", status: "waiting", note: "" },
  { key: "testchog", label: "Claim Test $CHOG", what: "The game's currency: revive fees, coins, tips.", status: "waiting", note: "" },
  { key: "mint", label: "Mint your Test Chog", what: "Your runner. A Test Drive mint: nobody signed for it, that is what the label means.", status: "waiting", note: "" },
  { key: "enter", label: "Enter with your stake", what: "You choose the amount and sign. Your stake stays withdrawable.", status: "waiting", note: "" },
];

const MIN_USDC = 1_000_000n; // 1 USDC is enough to start

export function Setup() {
  const wallet = useWallet();
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);

  const setStep = useCallback((key: StepKey, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  // Read the wallet's real state up front so the plan matches reality.
  const [balances, setBalances] = useState<{ usdc: bigint | null; quote: bigint | null }>({ usdc: null, quote: null });
  useEffect(() => {
    if (!wallet.address) return;
    const who = wallet.address as Address;
    void (async () => {
      const [usdc, quote] = await Promise.all([
        readUsdcBalance(testnetReadClient, who),
        readQuoteBalance(testnetReadClient, who),
      ]);
      setBalances({ usdc, quote });
    })();
  }, [wallet.address]);

  const run = useCallback(async () => {
    if (!wallet.address || !wallet.walletClient) return;
    const account = wallet.address as Address;
    setRunning(true);
    try {
      // 1. faucet
      if (balances.usdc !== null && balances.usdc >= MIN_USDC) {
        setStep("faucet", { status: "skipped", note: "Your wallet already holds USDC." });
      } else {
        setStep("faucet", { status: "running", note: "Waiting for your signature…" });
        const readyAt = await readStableFaucetReadyAt(testnetReadClient, account);
        if (Date.now() < readyAt * 1000) {
          setStep("faucet", { status: "skipped", note: `The faucet is on cooldown until ${new Date(readyAt * 1000).toUTCString()}.` });
        } else {
          const ok = await wallet.runTx(claimStableFaucet, undefined, "Claimed faucet test funds");
          setStep("faucet", ok
            ? { status: "done", note: "Faucet funds claimed." }
            : { status: "failed", note: "The claim did not go through. Try this step again." });
          if (!ok) return;
        }
      }

      // 2. swap quote -> USDC
      const quote = await readQuoteBalance(testnetReadClient, account);
      if (quote === 0n) {
        setStep("swap", { status: "skipped", note: "No quote token to swap. The faucet step feeds this one." });
      } else {
        setStep("swap", { status: "running", note: "Waiting for your signature…" });
        const allowance = await readQuoteRouterAllowance(testnetReadClient, account);
        if (allowance < quote) {
          const approved = await wallet.runTx(
            (walletClient, account_) => approveQuoteForRouter(walletClient, account_, quote),
            undefined,
            "Approved the swap router",
          );
          if (!approved) {
            setStep("swap", { status: "failed", note: "The approval did not go through. Try this step again." });
            return;
          }
        }
        const quotedOut = await quoteQuoteToAsset(testnetReadClient, quote);
        const ok = await wallet.runTx(
          (walletClient, account_) => swapQuoteToAsset(walletClient, account_, quote, quotedOut ?? 0n, testnetReadClient),
          undefined,
          "Swapped into USDC",
        );
        setStep("swap", ok
          ? { status: "done", note: `Swapped ${formatUsdc(quote)} quote into USDC.` }
          : { status: "failed", note: "The swap did not go through. Try this step again." });
        if (!ok) return;
      }

      // 3. Test $CHOG
      setStep("testchog", { status: "running", note: "Waiting for your signature…" });
      const chogReadyAt = await readTestChogReadyAt(testnetReadClient, account);
      if (Date.now() < chogReadyAt * 1000) {
        setStep("testchog", { status: "skipped", note: `Already claimed recently. Next claim at ${new Date(chogReadyAt * 1000).toUTCString()}.` });
      } else {
        const ok = await wallet.runTx(claimTestChog, undefined, "Claimed Test $CHOG");
        setStep("testchog", ok
          ? { status: "done", note: "Test $CHOG claimed. It pays revive fees and lands coin prizes." }
          : { status: "failed", note: "The claim did not go through. Try this step again." });
        if (!ok) return;
      }

      // 4. mint a Test Chog
      const existing = loadMyChog(account);
      if (existing !== null) {
        setStep("mint", { status: "skipped", note: `Chog #${existing} is already on this wallet.` });
      } else {
        setStep("mint", { status: "running", note: "Finding a free Chog…" });
        // A deterministic starting point per wallet, then walk forward until
        // an unclaimed Chog is found. Bounded: no hunting spree on chain.
        const start = Number(BigInt(account) % 1969n) + 1;
        let chosen: Awaited<ReturnType<typeof lookupChog>> | null = null;
        for (let i = 0; i < 8 && chosen === null; i++) {
          const id = BigInt(((start - 1 + i) % 1969) + 1);
          try {
            const found = await lookupChog(id);
            if (found.status === "unclaimed") chosen = found;
          } catch {
            // a read that does not answer is not "claimed": keep looking
          }
        }
        if (chosen === null) {
          setStep("mint", { status: "failed", note: "No free Chog found in this pass. Pick one at Get a Chog and come back." });
          return;
        }
        const tokenId = chosen.record.tokenId;
        const uri = chosen.record.tokenURI;
        setStep("mint", { status: "running", note: `Chog #${tokenId} is free. Waiting for your signature…` });
        const ok = await wallet.runTx(
          (walletClient, account_) =>
            walletClient.writeContract({
              address: DEPLOYED.mirror as Address,
              abi: mirrorAbi,
              functionName: "mintTestDrive",
              args: [tokenId, uri],
              account: account_,
              chain: walletClient.chain,
            } as never).then((hash) => ({ ok: true as const, hash, detail: "Test Drive mint sent." })),
          undefined,
          `Minted Test Drive Chog #${tokenId}`,
        );
        if (ok) {
          saveMyChog(account, tokenId);
          setStep("mint", { status: "done", note: `Chog #${tokenId} is yours to run as. Labelled Test Drive, exactly what it is.` });
        } else {
          setStep("mint", { status: "failed", note: "The mint did not go through. Try this step again." });
          return;
        }
      }

      // 5. enter
      setStep("enter", { status: "running", note: "Ready when you are." });
      await wallet.refresh();
      setBalances({
        usdc: await readUsdcBalance(testnetReadClient, account),
        quote: await readQuoteBalance(testnetReadClient, account),
      });
      setStep("enter", { status: "done", note: "Choose your stake amount on the next screen and sign once." });
    } finally {
      setRunning(false);
    }
  }, [balances.usdc, setStep, wallet]);

  const done = steps.every((s) => s.status === "done" || s.status === "skipped");

  return (
    <section className="section">
      <div className="section-head">
        <h1>Set me up</h1>
        <p className="muted">
          One guided path from an empty wallet to being entered. Every step is a real transaction
          you sign. Test funds only, and your stake stays withdrawable.
        </p>
      </div>

      <Panel className="feature-panel">
        <Card title="The setup" footer="EVERY STEP IS SIGNED BY YOU AND NOTHING ELSE">
          <ul>
            {steps.map((s) => (
              <li key={s.key}>
                <Badge tone={s.status === "done" ? "lime" : s.status === "failed" ? "danger" : "neutral"}>
                  {s.status === "waiting" ? "WAITING" : s.status === "running" ? "SIGNING…" : s.status === "done" ? "DONE" : s.status === "skipped" ? "SKIPPED" : "FAILED"}
                </Badge>{" "}
                <strong>{s.label}</strong>: {s.what}
                {s.note && <div className="muted small">{s.note}</div>}
              </li>
            ))}
          </ul>
          <div className="button-row">
            <Button onClick={() => void run()} disabled={running || !wallet.address}>
              {running ? "Working…" : "Set me up"}
            </Button>
            {done && (
              <Button variant="outline" onClick={() => navigate("/deposit")}>
                Enter with your stake ↗
              </Button>
            )}
          </div>
          {!wallet.address && <p className="muted small">Connect a wallet first, then this runs.</p>}
        </Card>
      </Panel>

      <div className="stat-row">
        <Stat label="USDC" value={balances.usdc === null ? "…" : `${formatUnits(balances.usdc, 6)}`} note="What the pool accepts." />
        <Stat label="FAUCET QUOTE" value={balances.quote === null ? "…" : `${formatUnits(balances.quote, 6)}`} note="Swapped into USDC by step 2." />
      </div>
    </section>
  );
}

export default Setup;
