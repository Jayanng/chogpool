// Replays: the runs worth watching. The stage plays a run's tape back with
// the story's commentary and the finish margin, and every number on it
// recomputes from the seed and the tape. The best run on today's course is
// here by default; paste any run record to watch it against that ghost.

import { useEffect, useState } from "react";
import { Badge, Card, Skeleton, Stat } from "@chogpool/ui";
import { ipfsToGateway } from "../lib/chog";
import { loadMyChog } from "../lib/mychog";
import { lookupChog } from "../lib/mirror";
import { tierOf, traitsOf } from "../lib/traits";
import { useWallet } from "../lib/useWallet";
import { appearanceOf, type ChogAppearance } from "../race/chogArt";
import { RunReplay } from "../game/RunReplay";
import { loadBestRun, todaySeed, type SavedRun } from "../game/Runner";
import { parseRunRecord, type RunRecord } from "../game/runRecord";

type Runner =
  | { phase: "loading" }
  | { phase: "ready"; appearance: ChogAppearance; image: string | null; testDrive: boolean }
  | { phase: "error"; message: string };

export function Replays() {
  const wallet = useWallet();
  const seed = todaySeed();
  const [runner, setRunner] = useState<Runner>({ phase: "loading" });
  const [best, setBest] = useState<SavedRun | null>(null);
  const [paste, setPaste] = useState("");
  const [watching, setWatching] = useState<RunRecord | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // The runner: the Chog this wallet brought to the track.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mine = wallet.address ? loadMyChog(wallet.address) : null;
      if (mine === null) {
        if (!cancelled) setRunner({ phase: "error", message: "No Chog on this wallet yet. Mint one at Get a Chog and it appears here." });
        return;
      }
      try {
        const lookup = await lookupChog(mine);
        const traits = traitsOf(lookup.record.metadata);
        const tier = tierOf(traits);
        if (cancelled) return;
        setRunner({
          phase: "ready",
          appearance: appearanceOf({ tier: tier ?? "untiered", traits, boost: 0n, perkId: null }),
          image: lookup.record.metadata.image ? ipfsToGateway(lookup.record.metadata.image) : null,
          testDrive: lookup.testDrive === true,
        });
      } catch {
        if (!cancelled) setRunner({ phase: "error", message: "The Chog's metadata could not be read, so this page will not draw an invented one." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  useEffect(() => {
    setBest(loadBestRun(seed));
  }, [seed]);

  const bestRecord: RunRecord | null =
    best !== null && best.distancePx !== undefined && best.coins !== undefined && best.closeCalls !== undefined
      ? {
          version: 1,
          seed: best.seed,
          lengthPx: 45000,
          inputs: best.inputs,
          reviveAt: best.reviveAt ?? null,
          claimed: {
            score: best.score,
            distance: best.distancePx,
            coins: best.coins,
            closeCalls: best.closeCalls,
            cleared: best.distancePx >= 45000,
            revived: best.revived,
          },
        }
      : null;

  function watch() {
    const parsed = parseRunRecord(paste);
    if (parsed.error !== null) {
      setPasteError(parsed.error);
      setWatching(null);
      return;
    }
    setPasteError(null);
    setWatching(parsed.record);
  }

  return (
    <section className="section">
      <div className="section-head">
        <h1>Replays</h1>
        <p className="muted">
          The tape plays back exactly as it was run. The commentary and the margin come from the run
          itself, and the Proof page re-derives every number from the seed and the presses.
        </p>
      </div>

      {runner.phase === "ready" && (watching !== null || bestRecord !== null) ? (
        <RunReplay
          record={watching ?? (bestRecord as RunRecord)}
          ghost={watching !== null ? bestRecord : null}
          appearance={runner.appearance}
          imageUrl={runner.image}
        />
      ) : runner.phase === "loading" ? (
        <Skeleton height={200} />
      ) : runner.phase === "error" ? (
        <Card title="The stage is ready" footer="A CHOG IS NEEDED TO STEP ONTO IT">
          <p className="muted small">{runner.message}</p>
        </Card>
      ) : (
        <Card title="No runs on this course yet" footer="PLAY A RUN AND IT APPEARS HERE">
          <p className="muted small">
            Finish a run at The Run and its tape is saved in this browser as the ghost of today's
            course. The stage replays it here.
          </p>
        </Card>
      )}

      {runner.phase === "ready" && (
        <div className="stat-row">
          {best !== null && <Stat label="GHOST" value={`SCORE ${best.score}`} note="your best on today's course" />}
          {runner.testDrive ? <Badge tone="neutral">TEST DRIVE</Badge> : <Badge tone="lime">VERIFIED HOLDER</Badge>}
        </div>
      )}

      <Card title="Watch another run" footer="PASTE THE RUN RECORD THE GAME COPIES AT THE FINISH">
        <label className="field">
          <span className="field-label">RUN RECORD</span>
          <textarea
            rows={5}
            placeholder='{"version":1,"seed":"...","inputs":[...]}'
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" onClick={watch} disabled={paste.trim() === ""}>
          Watch it against the ghost
        </button>
        {pasteError && <p className="error-text" role="alert">{pasteError}</p>}
      </Card>
    </section>
  );
}

export default Replays;
