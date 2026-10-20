// The Run page: pick your Chog, race today's seeded course. The character on
// the track is drawn from the Chog's REAL IPFS traits through the same
// honest art boundary as the race show. A lookup that cannot reach metadata
// gets an honest message, never an invented Chog.

import { useState } from "react";
import { Badge, Card, Skeleton, Stat } from "@chogpool/ui";
import { readChog } from "../lib/chog";
import { tierOf, traitsOf } from "../lib/traits";
import { useWallet } from "../lib/useWallet";
import { appearanceOf, type ChogAppearance } from "../race/chogArt";
import { Runner } from "../game/Runner";

type Picked =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; appearance: ChogAppearance; tokenId: bigint; name: string; owner: string; testDrive: boolean };

export function Game() {
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<Picked>({ phase: "idle" });
  const wallet = useWallet();

  async function pick() {
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
    setPicked({ phase: "loading" });
    try {
      const record = await readChog(tokenId);
      const traits = traitsOf(record.metadata);
      const tier = tierOf(traits);
      const appearance = appearanceOf({ tier: tier ?? "untiered", traits, boost: 0n, perkId: null });
      setPicked({
        phase: "ready",
        appearance,
        tokenId,
        name: record.metadata.name ?? `Chog #${tokenId}`,
        owner: record.owner,
        testDrive: false,
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
        title="Pick your runner"
        footer="TRAITS COME FROM THE CHOG'S REAL IPFS METADATA"
      >
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
          <button className="btn btn-primary" onClick={pick} disabled={picked.phase === "loading"}>
            {picked.phase === "loading" ? "Loading traits…" : "Run as this Chog"}
          </button>
        </div>
        {picked.phase === "error" && (
          <p className="error-text" role="alert">{picked.message}</p>
        )}
        {picked.phase === "loading" && <Skeleton height={80} />}
        {picked.phase === "ready" && (
          <div className="stat-row">
            <Stat label="RUNNER" value={picked.name} />
            <Stat label="CHOG ID" value={picked.tokenId.toString()} />
            {picked.testDrive ? (
              <Badge tone="neutral">TEST DRIVE</Badge>
            ) : wallet.address && picked.owner.toLowerCase() === wallet.address.toLowerCase() ? (
              <Badge tone="lime">VERIFIED HOLDER</Badge>
            ) : (
              // Looking up an ID never proves ownership, so this is practice
              // until the connected wallet matches the record's owner.
              <Badge tone="neutral">PRACTICE</Badge>
            )}
          </div>
        )}
      </Card>

      {picked.phase === "ready" ? (
        <Runner appearance={picked.appearance} />
      ) : (
        <Card title="The run" footer="PICK A CHOG TO STEP ONTO THE COURSE">
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
