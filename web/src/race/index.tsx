import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Panel } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { readCurrentRaceId } from "../lib/game";
import { RaceShow } from "./RaceShow";
import { useRaceBundle } from "./useRaceBundle";

/**
 * The race show. Every number and image on this page comes from the deployed
 * contracts or from the racers' real IPFS metadata. When the chain has no
 * answer (no draw yet, no reveal yet) the page says exactly that and stops.
 */
export default function Race() {
  const [drawId, setDrawId] = useState<bigint | null>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const { bundle, loading, error, reload } = useRaceBundle(drawId);

  useEffect(() => {
    let cancelled = false;
    readCurrentRaceId()
      .then((id) => {
        if (!cancelled && id !== null) setDrawId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // While a draw is still moving (open, closed, awarded), re-read the chain so
  // the show picks up the reveal without a manual refresh.
  const state = bundle?.draw.state ?? null;
  useEffect(() => {
    if (state !== "open" && state !== "closed" && state !== "awarded") return;
    const id = window.setInterval(reload, 20_000);
    return () => window.clearInterval(id);
  }, [state, reload]);

  const jump = useCallback(() => {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setInputError("Enter a race ID (a whole number, starting at 1).");
      return;
    }
    setInputError("");
    setDrawId(BigInt(raw));
  }, [input]);

  // A stale validation message never outlives a successful load: once a draw
  // is on screen (whichever button loaded it), the old error is gone.
  useEffect(() => {
    if (bundle) setInputError("");
  }, [bundle]);

  return (
    <>
      <section className="page-head page-head--compact">
        <p className="kicker">THE RACE</p>
        <h1>One seed.<br /><em>One result. One show.</em></h1>
        <p className="lede">
          The race animation is a deterministic replay of the on-chain draw result, never a source of it.
          Same seed, same result, same animation, every time. Pick any race and watch it again.
        </p>
        <div className="hero-actions">
          <Button onClick={() => navigate("/verify")}>Verify a race</Button>
          <Button variant="quiet" onClick={() => navigate("/spectator")}>Spectator mode</Button>
        </div>
      </section>

      <Panel className="feature-panel race-picker">
        <label className="field">
          <span>RACE ID</span>
          <input
            value={input}
            placeholder={drawId ? `Currently showing race ${drawId.toString()}` : "Race ID"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") jump(); }}
            inputMode="numeric"
          />
        </label>
        <div className="hero-actions">
          <Button variant="outline" onClick={jump}>Show that race</Button>
          {drawId !== null && (
            <Button variant="quiet" onClick={() => readCurrentRaceId().then((id) => { if (id !== null) { setInputError(""); setDrawId(id); } }).catch(() => {})}>
              Latest race
            </Button>
          )}
        </div>
        {inputError && <p className="viewer-error" role="alert">{inputError}</p>}
      </Panel>

      {drawId === null && !loading && (
        <Panel className="feature-panel">
          <Card title="The gates are quiet" footer="DRAWS ARE OPENED ON CHAIN BY THE OPERATOR">
            <ul className="rules-list">
              <li>No draw has been opened on chain yet, so there is no race to replay and no countdown to show.</li>
              <li>The countdown appears the moment a draw is opened, straight from the draw engine's own clock.</li>
              <li>In the meantime the verifier still explains exactly how a result is derived from a published seed.</li>
            </ul>
            <div className="hero-actions">
              <Button variant="outline" onClick={() => navigate("/verify")}>Open the verifier</Button>
              <Button variant="quiet" onClick={reload}>Check the chain again</Button>
            </div>
          </Card>
        </Panel>
      )}

      {loading && <Panel className="feature-panel"><p className="muted">Reading the draw from the chain…</p></Panel>}
      {error && (
        <Panel className="feature-panel">
          <p className="viewer-error" role="alert">{error}</p>
          <div className="hero-actions">
            <Button variant="outline" onClick={reload}>Try again</Button>
          </div>
        </Panel>
      )}

      {bundle && <RaceShow bundle={bundle} />}

      <Panel className="feature-panel">
        <Card title="How the show is built" footer="THE CONTRACTS ARE THE ONLY TRUTH">
          <ul className="rules-list">
            <li>Countdown straight from the draw engine, then the reveal, then the replay of the awarded result.</li>
            <li>Lane images and traits are the racers' real IPFS metadata, read from Monad mainnet.</li>
            <li>
              Pace and style labels are our design, derived from real traits and capped at +25% for presentation.
              They shape how the run looks and never who wins it.
            </li>
            <li>Confetti is seeded from the draw randomness. Sound is off until you turn it on.</li>
            <li>The winners, the prize and the trophy case are read back from the chain after the race.</li>
          </ul>
          <Badge tone="neutral">EVERY FRAME IS A FUNCTION OF THE PUBLISHED SEED</Badge>
        </Card>
      </Panel>
    </>
  );
}
