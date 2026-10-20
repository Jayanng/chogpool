// The Run: race today's seeded course as the Chog you brought to the track.
// The runner appears automatically from the Chog the wallet minted (the same
// mychog record the deposit flow uses), and its sprite is drawn from that
// Chog's REAL IPFS traits through the same honest art boundary as the race
// show. A lookup that cannot reach metadata gets an honest message, never an
// invented Chog.

import { useEffect, useState } from "react";
import { Badge, Card, Skeleton, Stat } from "@chogpool/ui";
import { loadMyChog } from "../lib/mychog";
import { lookupChog } from "../lib/mirror";
import { tierOf, traitsOf } from "../lib/traits";
import { useWallet } from "../lib/useWallet";
import { appearanceOf, type ChogAppearance } from "../race/chogArt";
import { Runner } from "../game/Runner";

type Picked =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      appearance: ChogAppearance;
      tokenId: bigint;
      name: string;
      owner: string;
      mirrorOwner: string | null;
      testDrive: boolean;
    };

export function Game() {
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<Picked>({ phase: "idle" });
  const wallet = useWallet();

  async function pickToken(tokenId: bigint) {
    setPicked({ phase: "loading" });
    try {
      const lookup = await lookupChog(tokenId);
      const record = lookup.record;
      const traits = traitsOf(record.metadata);
      const tier = tierOf(traits);
      const appearance = appearanceOf({ tier: tier ?? "untiered", traits, boost: 0n, perkId: null });
      setPicked({
        phase: "ready",
        appearance,
        tokenId,
        name: record.metadata.name ?? `Chog #${tokenId}`,
        owner: record.owner,
        mirrorOwner: lookup.mirrorOwner ?? null,
        testDrive: lookup.testDrive === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lookup failed.";
      setPicked({
        phase: "error",
        message: message.includes("Failed to fetch") || message.includes("NetworkError")
          ? "Network or RPC unavailable. Check your connection and try again."
          : message,
      });
    }
  }

  function pick() {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setPicked({ phase: "error", message: "Enter a Chog ID from 1 to 1,969." });
      return;
    }
    const tokenId = BigInt(raw);
    if (tokenId < 1n || tokenId > 1969n) {
      setPicked({ phase: "error", message: "Enter a Chog ID from 1 to 1,969." });
      return;
    }
    void pickToken(tokenId);
  }

  // The minted Chog appears on its own: whatever this wallet brought to the
  // track (mirror mint or Test Drive) steps straight onto the course. No
  // typing. The manual picker below stays as an override.
  useEffect(() => {
    if (!wallet.address || picked.phase !== "idle") return;
    const mine = loadMyChog(wallet.address);
    if (mine !== null) {
      void pickToken(mine);
    }
  }, [wallet.address, picked.phase]);

  const held =
    picked.phase === "ready" &&
    ((picked.mirrorOwner !== null && picked.mirrorOwner.toLowerCase() === (wallet.address ?? "").toLowerCase()) ||
      picked.owner.toLowerCase() === (wallet.address ?? "").toLowerCase());

  return (
    <section className="section">
      <div className="section-head">
        <h1>The Run</h1>
        <p className="muted">
          Your Chog is the runner. One seeded course for everyone today, the ghost of the course's
          best beside you, and every run replayable from its seed and inputs.
        </p>
      </div>

      <Card
        title="Your runner"
        footer="TRAITS COME FROM THE CHOG'S REAL IPFS METADATA"
      >
        {picked.phase === "loading" && <Skeleton height={80} />}
        {picked.phase === "error" && (
          <p className="error-text" role="alert">{picked.message}</p>
        )}
        {picked.phase === "ready" && (
          <div className="stat-row">
            <Stat label="RUNNER" value={picked.name} />
            <Stat label="CHOG ID" value={picked.tokenId.toString()} />
            {picked.testDrive ? (
              <Badge tone="neutral">TEST DRIVE</Badge>
            ) : held ? (
              <Badge tone="lime">VERIFIED HOLDER</Badge>
            ) : (
              // A typed ID never proves ownership, so this is practice until
              // the wallet matches the record or its mirror holder.
              <Badge tone="neutral">PRACTICE</Badge>
            )}
          </div>
        )}
        <p className="muted small">
          Your minted Chog appears here automatically. Running as a different Chog? Pick one by id.
        </p>
        <div className="stat-row">
          <label className="field">
            <span className="field-label">CHOG ID</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="e.g. 70"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button className="btn btn-secondary" onClick={pick} disabled={picked.phase === "loading"}>
            Run as this Chog
          </button>
        </div>
      </Card>

      {picked.phase === "ready" ? (
        <Runner key={picked.tokenId.toString()} appearance={picked.appearance} />
      ) : (
        <Card title="The run" footer="YOUR CHOG STEPS ONTO THE COURSE">
          <p className="muted small">
            Space or tap to jump, hold for the full arc, duck under the gates. Coins sit on the good
            racing line, close calls pay bonus points, and one revive per run lifts you over the
            crash with your score kept.
          </p>
        </Card>
      )}
    </section>
  );
}

export default Game;
