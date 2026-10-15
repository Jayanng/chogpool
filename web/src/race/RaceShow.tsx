// The race show: a deterministic replay of a draw the chain has already
// decided. The lanes, the pace, the photo finish and the podium are built
// purely from the draw's published final randomness, the frozen ticket book
// and the racers' real IPFS traits. The winner on screen is the winner the
// contract recorded; the replay never decides anything.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { Badge, Button, Panel, tokens } from "@chogpool/ui";
import { buildRaceReplay, type RaceReplay } from "../lib/race-engine";
import { perkEffectFor } from "../lib/draft";
import { isSoundMuted, playCue, setSoundMuted } from "../lib/sound";
import { formatAsset, formatBps, formatTickets, shortHex } from "../lib/format";
import { navigate } from "../lib/router";
import { Countdown } from "../components/Countdown";
import { ShareCard, type ShareCardResult } from "../components/ShareCard";
import { Confetti } from "./Confetti";
import type { RaceBundle, RacerDisplay } from "./useRaceBundle";

/** Wall-clock seconds of the replay at full speed. The frames themselves are
 *  pure; only the playback clock is time-based. */
const RACE_SECONDS = 20;
const SLOWMO_FROM = 0.82;
const SLOWMO_SPEED = 0.32;

const ZERO_WORD: Hex = `0x${"0".repeat(64)}`;

type Phase = "gates" | "running" | "done";

export function RaceShow({ bundle }: { bundle: RaceBundle }) {
  const { draw, events, racers } = bundle;
  const decided = (draw.state === "awarded" || draw.state === "finalized") && BigInt(draw.finalRandomness) !== 0n;

  const replay: RaceReplay | null = useMemo(() => {
    if (!decided) return null;
    return buildRaceReplay({
      drawId: draw.drawId,
      finalRandomness: draw.finalRandomness,
      winners: draw.winners,
      lanes: racers.map((r) => ({
        tokenId: r.tokenId,
        tickets: r.tickets,
        boost: r.boost,
        tier: r.tier,
        traits: r.traits,
        perk: perkEffectFor(draw.drawId.toString(), r.tokenId.toString()),
      })),
    });
    // The replay is a pure function of these exact inputs.
  }, [draw.drawId, draw.finalRandomness, draw.winners, decided]); // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState<Phase>("gates");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState(isSoundMuted);
  const [slowmo, setSlowmo] = useState(false);
  const tRef = useRef(0);
  const finishCued = useRef(false);

  const winnerRacer = racers.find((r) => r.tokenId === draw.winners[0]) ?? null;
  const winnerIndexInLanes = replay ? replay.lanes.findIndex((l) => l.tokenId === replay.winner) : -1;

  function progressSnapshot(t: number): Record<string, number> {
    if (!replay) return {};
    const values = replay.progressAt(t);
    const out: Record<string, number> = {};
    replay.lanes.forEach((lane, i) => {
      out[lane.tokenId.toString()] = values[i] ?? 0;
    });
    return out;
  }

  function startRace() {
    if (!replay) return;
    tRef.current = 0;
    finishCued.current = false;
    setSlowmo(false);
    setProgress(progressSnapshot(0));
    playCue("gates");
    setPhase("running");
  }

  useEffect(() => {
    if (!replay) return;
    // Runs start on load for decided draws: the show is the replay.
    startRace();
    return () => setPhase("gates");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  useEffect(() => {
    if (phase !== "running" || !replay) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const current = replay.progressAt(tRef.current);
      const winnerProgress = winnerIndexInLanes >= 0 ? current[winnerIndexInLanes] : 1;
      const inSlowmo = winnerProgress > SLOWMO_FROM && winnerProgress < 1;
      setSlowmo(inSlowmo);
      tRef.current += (dt / RACE_SECONDS) * (inSlowmo ? SLOWMO_SPEED : 1);
      if (winnerProgress >= 1 && !finishCued.current) {
        finishCued.current = true;
        playCue("finish");
      }
      if (tRef.current >= 1) {
        setProgress(progressSnapshot(1));
        playCue("fanfare");
        setPhase("done");
        return;
      }
      setProgress(progressSnapshot(tRef.current));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, replay, winnerIndexInLanes]);

  const totalTickets = racers.reduce((acc, r) => acc + r.tickets, 0n);
  const shareResult: ShareCardResult | null =
    decided && winnerRacer
      ? {
          drawId: draw.drawId.toString(),
          winnerName: winnerRacer.name,
          winnerTokenId: winnerRacer.tokenId.toString(),
          winnerImageUrl: winnerRacer.imageUrl,
          potLabel: formatAsset(draw.potPerWinner),
        }
      : null;

  return (
    <div className="show">
      <Panel className="show-stage">
        <div className="show-top">
          <div>
            <p className="kicker">RACE {draw.drawId.toString()} · {stateLabel(draw.state)}</p>
            <h2 className="show-title">{decided ? "The replay of the real result." : gatesTitle(draw.state)}</h2>
          </div>
          <div className="show-controls">
            {decided && (
              <Button variant="outline" onClick={startRace}>{phase === "running" ? "Racing…" : "Run the replay"}</Button>
            )}
            <Button variant="quiet" onClick={() => { const next = !muted; setSoundMuted(next); setMuted(next); }}>
              {muted ? "Sound off" : "Sound on"}
            </Button>
          </div>
        </div>

        {draw.state === "open" && (
          <div className="show-status">
            <Countdown nextDrawAt={draw.closeAt} sourceLabel="LIVE FROM THE DRAW ENGINE (drawCloseAt)" />
            <p className="muted">
              The gates close when the commit window ends and the field locks. The race you watch here is a
              replay of the revealed result, so it starts once the seed is revealed and the draw is awarded.
            </p>
          </div>
        )}
        {draw.state === "closed" && (
          <div className="show-status">
            <p className="show-status-line">SEED COMMITTED · AWAITING REVEAL</p>
            <p className="muted">
              The operator committed <code>{shortHex(draw.commitHash)}</code> before the window closed. The reveal
              publishes the seed and binds the reveal block's hash; until then there is no result to replay, and
              this page will not invent one.
            </p>
          </div>
        )}

        <div className="show-lanes">
          {racers.map((racer) => (
            <LaneRow
              key={racer.tokenId.toString()}
              racer={racer}
              progress={progress[racer.tokenId.toString()] ?? 0}
              share={totalTickets === 0n ? 0n : (racer.tickets * 10000n) / totalTickets}
              drawId={draw.drawId.toString()}
              isWinner={decided && racer.tokenId === draw.winners[0]}
              showResult={phase === "done"}
            />
          ))}
        </div>

        <div className="show-foot">
          <Badge tone={slowmo ? "accent" : "neutral"}>{slowmo ? "PHOTO FINISH" : phase === "done" ? "RACE COMPLETE" : phase === "running" ? "RACING" : "AT THE GATES"}</Badge>
          <span className="show-disclosure">
            Pace, style and shape are our design, derived from each Chog's real IPFS traits and capped at +25% for
            the show. The draw itself is decided on chain; this replay reproduces that result and nothing else.
          </span>
        </div>
      </Panel>

      {decided && phase === "done" && (
        <div className="podium-wrap">
          <Confetti seed={draw.finalRandomness} active />
          <Podium bundle={bundle} replay={replay} winnerRacer={winnerRacer} eventsLabel={eventsLabel(events)} />
        </div>
      )}

      {decided && phase !== "done" && winnerRacer && (
        <Panel className="truth-strip">
          <Badge tone="lime">ON-CHAIN RESULT</Badge>
          <span>
            The chain already recorded this race: winner CHOG #{winnerRacer.tokenId.toString()}
            {winnerRacer.name !== `CHOG #${winnerRacer.tokenId.toString()}` ? ` (IPFS metadata name: ${winnerRacer.name})` : ""},
            paid {formatAsset(draw.potPerWinner)}. The replay on screen is that result, frame for frame, every time.
          </span>
          <Button variant="outline" onClick={() => navigate("/verify")}>Verify the draw</Button>
        </Panel>
      )}

      {shareResult && (
        <section className="share-section">
          <ShareCard
            chog={winnerRacer ? { tokenId: winnerRacer.tokenId.toString(), imageUrl: winnerRacer.imageUrl, name: winnerRacer.name } : null}
            raceLabel={`Race ${draw.drawId.toString()} · ${stateLabel(draw.state)}`}
            result={shareResult}
          />
        </section>
      )}
    </div>
  );
}

function stateLabel(state: string): string {
  if (state === "open") return "GATES OPEN";
  if (state === "closed") return "AWAITING REVEAL";
  if (state === "awarded") return "RESULT IN";
  if (state === "finalized") return "FINALIZED";
  return "NO DRAW";
}

function gatesTitle(state: string): string {
  if (state === "open") return "The field is filling. The gates are not open yet.";
  if (state === "closed") return "The seed is committed. The race waits for its reveal.";
  return "No result to replay yet.";
}

function eventsLabel(events: RaceBundle["events"]): string {
  if (!events) return "";
  return events.awardedAt ? `Awarded at block ${events.awardedAt.blockNumber.toString()}` : "";
}

function LaneRow({
  racer,
  progress,
  share,
  drawId,
  isWinner,
  showResult,
}: {
  racer: RacerDisplay;
  progress: number;
  share: bigint;
  drawId: string;
  isWinner: boolean;
  showResult: boolean;
}) {
  const perk = perkEffectFor(drawId, racer.tokenId.toString());
  return (
    <div className={`show-lane${isWinner && showResult ? " show-lane--winner" : ""}`}>
      <div className="show-lane-head">
        <span className="show-lane-id">CHOG #{racer.tokenId.toString()}</span>
        {racer.badge && racer.badge.badge !== 0 && (
          <Badge tone={racer.badge.badge === 2 ? "lime" : "neutral"}>{racer.badge.badgeLabel}</Badge>
        )}
        {racer.metadataMissing && <Badge tone="danger">METADATA UNREACHABLE</Badge>}
        {racer.tier && <Badge tone="neutral">TIER: {racer.tier.toUpperCase()}</Badge>}
      </div>
      <div className="show-track">
        <div className="show-runner" style={{ left: `calc(${(progress * 100).toFixed(3)}% - 28px)` }}>
          {racer.imageUrl ? (
            <img src={racer.imageUrl} alt={`CHOG #${racer.tokenId.toString()}`} className="show-runner-img" />
          ) : (
            <span className="show-runner-dot">◉</span>
          )}
        </div>
      </div>
      <div className="show-lane-meta">
        <span>{formatTickets(racer.tickets)} tickets · {formatBps(share)} of the frozen book</span>
        {racer.name !== `CHOG #${racer.tokenId.toString()}` && <span>IPFS NAME: {racer.name.toUpperCase()}</span>}
        {perk && <span className="show-perk">PERK: {perk.name.toUpperCase()} (SHOW ONLY)</span>}
      </div>
    </div>
  );
}

function Podium({
  bundle,
  replay,
  winnerRacer,
  eventsLabel,
}: {
  bundle: RaceBundle;
  replay: RaceReplay | null;
  winnerRacer: RacerDisplay | null;
  eventsLabel: string;
}) {
  const { draw, events, racers } = bundle;
  const runners = replay ? replay.finishOrder.slice(1) : [];
  return (
    <Panel className="podium">
      <div className="podium-head">
        <Badge tone="lime">PODIUM</Badge>
        <h2>CHOG #{draw.winners[0]?.toString() ?? "?"} takes the race.</h2>
      </div>
      <div className="podium-grid">
        <div className="podium-winner">
          {winnerRacer?.imageUrl && (
            <img src={winnerRacer.imageUrl} alt={`CHOG #${draw.winners[0]?.toString()}`} className="podium-img" />
          )}
          <div>
            <p className="kicker">ON-CHAIN WINNER · WINNERSOF({draw.drawId.toString()})</p>
            <h3>
              CHOG #{draw.winners[0]?.toString()}
              {winnerRacer && winnerRacer.name !== `CHOG #${draw.winners[0]?.toString()}` ? ` · IPFS metadata name: ${winnerRacer.name}` : ""}
            </h3>
            {winnerRacer?.badge && winnerRacer.badge.badge !== 0 && (
              <Badge tone={winnerRacer.badge.badge === 2 ? "lime" : "neutral"}>{winnerRacer.badge.badgeLabel}</Badge>
            )}
            <p className="muted">
              Prize paid: {formatAsset(draw.potPerWinner)} straight from the yield-funded pot to the depositor
              behind the position{winnerRacer?.team ? <> ({shortHex(winnerRacer.team, 10, 8)})</> : null}.
              {eventsLabel ? ` ${eventsLabel}.` : ""}
            </p>
            {winnerRacer?.career && (
              <p className="muted">
                Trophy case after this race: {winnerRacer.career.gold} gold, {winnerRacer.career.silver} silver,{" "}
                {winnerRacer.career.bronze} bronze across {winnerRacer.career.races} race
                {winnerRacer.career.races === 1 ? "" : "s"}. Recorded by the CareerStore in the award transaction.
              </p>
            )}
            {events && events.inscriptions.length > 0 && (
              <p className="show-inscription">
                INSCRIPTION EVENT: RaceRecorded at block {events.inscriptions[0].blockNumber.toString()} (tx{" "}
                {shortHex(events.inscriptions[0].txHash, 10, 8)}), placement {events.inscriptions[0].placement}.
              </p>
            )}
            <div className="hero-actions">
              <Button onClick={() => navigate("/verify")}>Re-derive this result</Button>
              <Button variant="outline" onClick={() => navigate("/spectator")}>Cheer the field</Button>
            </div>
          </div>
        </div>
        <div className="podium-rest">
          <p className="kicker">THE REST OF THE FIELD</p>
          {runners.length === 0 && <p className="muted">A one-racer field: the book held a single racer this draw.</p>}
          {runners.map((tokenId, i) => {
            const racer = racers.find((r) => r.tokenId === tokenId);
            return (
              <p className="podium-place" key={tokenId.toString()}>
                <span>{i + 2}.</span> CHOG #{tokenId.toString()}
                {racer && racer.name !== `CHOG #${tokenId.toString()}` ? <em>IPFS NAME: {racer.name.toUpperCase()}</em> : null}
                <em> show order (presentation)</em>
              </p>
            );
          })}
          <p className="show-disclosure">
            Only place 1 is decided on chain. The rest of the finishing order is deterministic show flavor from
            the same seed, labeled wherever it appears.
          </p>
        </div>
      </div>
    </Panel>
  );
}
