// The race show: a deterministic replay of a draw the chain has already
// decided. The lanes, the pace, the photo finish and the podium are built
// purely from the draw's published final randomness, the frozen ticket book
// and the racers' real IPFS traits. The winners on screen are the winners the
// contract recorded; the replay never decides anything.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { Badge, Button, Panel } from "@chogpool/ui";
import { buildRaceReplay, type RaceReplay } from "../lib/race-engine";
import { perkEffectFor } from "../lib/draft";
import { isSoundMuted, playCue, setSoundMuted } from "../lib/sound";
import { formatAsset, formatBps, formatTickets, hexIsNonZero, shortHex } from "../lib/format";
import { getRaceSource } from "../lib/game";
import { navigate } from "../lib/router";
import {
  inscriptionFor,
  ipfsName,
  isWinnerToken,
  joinWithAnd,
  podiumPlacesFooter,
  podiumPrizeSentence,
  prizePerWinner,
  replayDisclosure,
  replayHeadline,
  resultStripCopy,
  trophySentence,
  winnerHeadline,
  winnerKickerLabel,
  type CareerSource,
  type InscriptionEvidence,
} from "../lib/result-copy";
import { Countdown } from "../components/Countdown";
import { ShareCard, type ShareCardResult } from "../components/ShareCard";
import { ChogSprite } from "../components/ChogSprite";
import { appearanceOf } from "./chogArt";
import { Confetti } from "./Confetti";
import { countUpT, countUpValue, ordinalPlace, runnerLeft, trailWidth } from "./visual";
import type { RaceBundle, RacerDisplay } from "./useRaceBundle";

/** Wall-clock seconds of the replay at full speed. The frames themselves are
 *  pure; only the playback clock is time-based. */
const RACE_SECONDS = 20;
/** The last stretch of the winner's run plays as a photo finish: the clock
 *  dilates here and only here. The frames it walks through are unchanged. */
const SLOWMO_FROM = 0.85;
const SLOWMO_SPEED = 0.36;
/** The finished frame holds this long before the podium is revealed. */
const FINISH_HOLD_MS = 1500;
/** Runner art width in the track; the CSS variable matches this. */
const RUNNER_PX = 96;

const ZERO_WORD: Hex = `0x${"0".repeat(64)}`;

type Phase = "gates" | "running" | "photo" | "done";

/** One on-chain winner with the display data and the page's own evidence for
 *  it. The inscription is the RaceRecorded event for this draw, when the logs
 *  hold one; the trophy line may claim a recording only when it is there. */
type WinnerView = {
  tokenId: bigint;
  racer: RacerDisplay | null;
  inscription: InscriptionEvidence | null;
};

export function RaceShow({ bundle }: { bundle: RaceBundle }) {
  const { draw, events, racers } = bundle;
  // "0x" is the soft-read fallback, not a number: never hand it to BigInt().
  const decided = (draw.state === "awarded" || draw.state === "finalized") && hexIsNonZero(draw.finalRandomness);

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
  }, [draw.drawId, draw.finalRandomness, draw.winners, decided, racers]);

  const [phase, setPhase] = useState<Phase>("gates");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState(isSoundMuted);
  const [slowmo, setSlowmo] = useState(false);
  const [finished, setFinished] = useState(false);
  const [finishBurst, setFinishBurst] = useState(false);
  const tRef = useRef(0);
  const finishCued = useRef(false);
  const burstTimer = useRef(0);

  const winnerViews: WinnerView[] = draw.winners.map((tokenId) => ({
    tokenId,
    racer: racers.find((r) => r.tokenId === tokenId) ?? null,
    inscription: inscriptionFor(events?.inscriptions ?? [], tokenId),
  }));
  const winnerIndexInLanes = replay ? replay.lanes.findIndex((l) => l.tokenId === replay.winner) : -1;
  const liveSource = getRaceSource()?.kind === "live";
  // A rehearsal draw exists only in this draw's record. It drops the on-chain
  // wording everywhere it shows; real draws keep the chain wording untouched.
  const rehearsal = draw.rehearsal === true;

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
    window.clearTimeout(burstTimer.current);
    setSlowmo(false);
    setFinished(false);
    setFinishBurst(false);
    setProgress(progressSnapshot(0));
    playCue("gates");
    setPhase("running");
  }

  useEffect(() => {
    if (!replay) return;
    // Runs start on load for decided draws: the show is the replay.
    startRace();
    return () => {
      window.clearTimeout(burstTimer.current);
      setPhase("gates");
    };
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
        setFinished(true);
        setFinishBurst(true);
        playCue("finish");
        burstTimer.current = window.setTimeout(() => setFinishBurst(false), 1600);
      }
      if (tRef.current >= 1) {
        setProgress(progressSnapshot(1));
        setPhase("photo");
        return;
      }
      setProgress(progressSnapshot(tRef.current));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, replay, winnerIndexInLanes]);

  // The photo-finish hold: the finished frame stays on screen for a beat, then
  // the podium is revealed with the fanfare.
  useEffect(() => {
    if (phase !== "photo") return;
    const id = window.setTimeout(() => {
      playCue("fanfare");
      setPhase("done");
    }, FINISH_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const totalTickets = racers.reduce((acc, r) => acc + r.tickets, 0n);
  const zeroPot = draw.potPerWinner === 0n;
  const shareResult: ShareCardResult | null =
    decided && winnerViews.length > 0
      ? {
          drawId: draw.drawId.toString(),
          winners: winnerViews.map((view) => ({
            tokenId: view.tokenId.toString(),
            name: view.racer ? ipfsName(view.tokenId, view.racer.name, view.racer.metadataMissing) : null,
            imageUrl: view.racer?.imageUrl ?? null,
          })),
          potLabel: formatAsset(draw.potPerWinner),
          zeroPot,
          rehearsal,
        }
      : null;

  const strip = resultStripCopy({
    rehearsal,
    winnersLabel: joinWithAnd(winnerViews.map((view) => displayLabel(view))),
    winnerCount: winnerViews.length,
    prizeLabel: prizePerWinner(draw.winners, formatAsset(draw.potPerWinner)),
    potLabel: formatAsset(draw.potPerWinner),
    zeroPot,
  });

  return (
    <div className="show">
      <Panel className={`show-stage${finishBurst ? " show-stage--finish" : ""}${slowmo ? " show-stage--slowmo" : ""}`}>
        <div className="show-top">
          <div>
            <p className="kicker">RACE {draw.drawId.toString()} · {stateLabel(draw.state, rehearsal)}</p>
            <h2 className="show-title">{decided ? replayHeadline(rehearsal) : gatesTitle(draw.state)}</h2>
          </div>
          <div className="show-controls">
            {decided && (
              <span className="show-replay">
                <Button variant="outline" onClick={startRace}>
                  <span className="replay-icon" aria-hidden="true">↻</span>
                  {phase === "running" ? "Racing…" : "Run the replay"}
                </Button>
              </span>
            )}
            <Button variant="quiet" onClick={() => { const next = !muted; setSoundMuted(next); setMuted(next); }}>
              {muted ? "Sound off" : "Sound on"}
            </Button>
          </div>
        </div>

        {draw.state === "open" && (
          <div className="show-status">
            <Countdown
              nextDrawAt={draw.closeAt > 0 ? draw.closeAt : null}
              fieldLocked={false}
              sourceLabel={liveSource ? "LIVE FROM THE DRAW ENGINE (drawCloseAt)" : "FROM THE RECORDED DRAW (drawCloseAt)"}
            />
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
          {racers.map((racer) => {
            const place = draw.winners.findIndex((w) => w === racer.tokenId);
            return (
              <LaneRow
                key={racer.tokenId.toString()}
                racer={racer}
                progress={progress[racer.tokenId.toString()] ?? 0}
                share={totalTickets === 0n ? 0n : (racer.tickets * 10000n) / totalTickets}
                drawId={draw.drawId.toString()}
                isWinner={decided && isWinnerToken(draw.winners, racer.tokenId)}
                place={place >= 0 ? place + 1 : null}
                showResult={finished}
                moving={phase === "running"}
                burst={finishBurst}
                seed={draw.finalRandomness}
              />
            );
          })}
        </div>

        <div className="show-foot">
          <Badge tone={slowmo || phase === "photo" ? "accent" : "neutral"}>
            {slowmo || phase === "photo" ? "PHOTO FINISH" : phase === "done" ? "RACE COMPLETE" : phase === "running" ? "RACING" : "AT THE GATES"}
          </Badge>
          <span className="show-disclosure">{replayDisclosure(rehearsal)}</span>
        </div>
      </Panel>

      {decided && phase === "done" && (
        <div className="podium-wrap">
          <Confetti seed={draw.finalRandomness} active count={420} />
          <Podium bundle={bundle} replay={replay} winners={winnerViews} eventsLabel={eventsLabel(events)} />
        </div>
      )}

      {decided && phase !== "done" && winnerViews.length > 0 && (
        <Panel className="truth-strip">
          <Badge tone={rehearsal ? "neutral" : "lime"}>{strip.badge}</Badge>
          <span>{strip.body}</span>
          <Button variant="outline" onClick={() => navigate("/verify")}>Verify the draw</Button>
        </Panel>
      )}

      {shareResult && (
        <section className="share-section">
          <ShareCard
            chog={winnerViews[0]?.racer ? { tokenId: winnerViews[0].racer.tokenId.toString(), imageUrl: winnerViews[0].racer.imageUrl, name: winnerViews[0].racer.name } : null}
            raceLabel={`Race ${draw.drawId.toString()} · ${stateLabel(draw.state, rehearsal)}`}
            result={shareResult}
          />
        </section>
      )}
    </div>
  );
}

/** The pill over the show. A rehearsal draw exists only in its own record, so
 *  its pill names that record and never wears chain-state vocabulary; real
 *  draws keep the exact state labels they had. */
function stateLabel(state: string, rehearsal: boolean): string {
  if (rehearsal) return "REHEARSAL RECORD";
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

/** "CHOG #1462", with the real IPFS metadata name where one exists. */
function displayLabel(view: WinnerView): string {
  const base = `CHOG #${view.tokenId.toString()}`;
  const name = view.racer ? ipfsName(view.tokenId, view.racer.name, view.racer.metadataMissing) : null;
  return name ? `${base} (IPFS metadata name: ${name})` : base;
}

function LaneRow({
  racer,
  progress,
  share,
  drawId,
  isWinner,
  place,
  showResult,
  moving,
  burst,
  seed,
}: {
  racer: RacerDisplay;
  progress: number;
  share: bigint;
  drawId: string;
  isWinner: boolean;
  /** Winning place from the draw's own winner list, or null when not a winner. */
  place: number | null;
  showResult: boolean;
  moving: boolean;
  burst: boolean;
  seed: Hex;
}) {
  const perk = perkEffectFor(drawId, racer.tokenId.toString());
  const appearance = appearanceOf({ tier: racer.tier, traits: racer.traits, boost: racer.boost, perkId: perk?.id ?? null });
  const name = ipfsName(racer.tokenId, racer.name, racer.metadataMissing);
  const idLabel = `CHOG #${racer.tokenId.toString()}`;
  return (
    <div className={`show-lane${isWinner && showResult ? " show-lane--winner" : ""}`}>
      {isWinner && showResult && (
        <span className={`show-winner-ribbon${place === 2 ? " show-winner-ribbon--silver" : ""}`}>WINNER</span>
      )}
      {isWinner && burst && <Confetti seed={seed} active count={110} frames={110} mode="burst" salt={Number(racer.tokenId % 4096n)} />}
      <div className="show-lane-head">
        <span className="show-lane-id">{idLabel}</span>
        {racer.badge.state === "value" && (
          <Badge tone={racer.badge.value.badge === 2 ? "lime" : "neutral"}>{racer.badge.value.badgeLabel}</Badge>
        )}
        {racer.badge.state === "failed" && <Badge tone="neutral">BADGE UNKNOWN</Badge>}
        {racer.metadataMissing && <Badge tone="danger">METADATA UNREACHABLE</Badge>}
        {racer.tier && <Badge tone="neutral">TIER: {racer.tier.toUpperCase()}</Badge>}
      </div>
      <div className={`show-track${moving ? " show-track--moving" : ""}`}>
        <div className="show-trail" style={{ width: trailWidth(progress) }} />
        <div className={`show-runner${appearance.aura ? " show-runner--aura" : ""}`} style={{ left: runnerLeft(progress, RUNNER_PX) }}>
          {racer.imageUrl ? (
            <img src={racer.imageUrl} alt={idLabel} className="show-runner-img" />
          ) : racer.metadataMissing ? (
            <span className="show-runner-dot">◉</span>
          ) : (
            <ChogSprite appearance={appearance} />
          )}
          <span className="show-runner-plate">{idLabel}</span>
        </div>
        <div className="show-finish" aria-hidden="true" />
        <span className="show-finish-label" aria-hidden="true">FINISH</span>
      </div>
      <div className="show-lane-meta">
        <span>{formatTickets(racer.tickets)} tickets · {formatBps(share)} of the frozen book</span>
        {name && <span>IPFS NAME: {name.toUpperCase()}</span>}
        {perk && <span className="show-perk">PERK: {perk.name.toUpperCase()} (SHOW ONLY)</span>}
      </div>
    </div>
  );
}

function Podium({
  bundle,
  replay,
  winners,
  eventsLabel,
}: {
  bundle: RaceBundle;
  replay: RaceReplay | null;
  winners: WinnerView[];
  eventsLabel: string;
}) {
  const { draw, racers } = bundle;
  const winnerKeys = new Set(draw.winners.map((w) => w.toString()));
  const runners = replay ? replay.finishOrder.filter((t) => !winnerKeys.has(t.toString())) : [];
  const zeroPot = draw.potPerWinner === 0n;
  const rehearsal = draw.rehearsal === true;
  const careerSource: CareerSource = draw.recordedCareers ? "draw-record" : "live-read";
  return (
    <Panel className="podium">
      <div className="podium-head">
        <Badge tone="lime">PODIUM</Badge>
        <h2>{winnerHeadline(draw.winners)}</h2>
      </div>
      <div className="podium-grid">
        <div className="podium-stage">
          <div className="podium-winners">
            {winners.map((view, i) => (
              <div className="podium-winner-slot" key={view.tokenId.toString()}>
                <WinnerBlock
                  view={view}
                  place={i + 1}
                  drawId={draw.drawId.toString()}
                  winnerTokens={draw.winners}
                  potLabel={formatAsset(draw.potPerWinner)}
                  pot={draw.potPerWinner}
                  eventsLabel={eventsLabel}
                  zeroPot={zeroPot}
                  rehearsal={rehearsal}
                  careerSource={careerSource}
                />
                <span className={`podium-step ${i === 0 ? "podium-step--gold" : "podium-step--silver"}`} aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="podium-rest">
            <p className="kicker">{draw.winners.length === 1 ? "RUNNER-UP · SHOW ORDER" : "THE REST OF THE FIELD"}</p>
            {runners.length === 0 && (
              <p className="muted">
                {racers.length === 1
                  ? "A one-racer field: the book held a single racer this draw."
                  : "Every racer in the book is a winner this draw."}
              </p>
            )}
            {runners.length > 0 && (
              <div className="podium-field">
                {runners.map((tokenId, i) => {
                  const racer = racers.find((r) => r.tokenId === tokenId);
                  const name = racer ? ipfsName(tokenId, racer.name, racer.metadataMissing) : null;
                  return (
                    <div className="podium-field-slot" key={tokenId.toString()}>
                      <div className={`podium-field-card${i === 0 ? " podium-field-card--runner-up" : ""}`}>
                        <div className="podium-field-shot">
                          <span className="podium-spotlight" aria-hidden="true" />
                          {racer?.imageUrl && (
                            <img src={racer.imageUrl} alt={`CHOG #${tokenId.toString()}`} className="podium-field-img" />
                          )}
                          <span className="podium-field-rank">{ordinalPlace(i + draw.winners.length + 1)}</span>
                        </div>
                        <div className="podium-field-body">
                          <p className="podium-field-id">CHOG #{tokenId.toString()}</p>
                          {name && <em>IPFS NAME: {name.toUpperCase()}</em>}
                          <em className="podium-show-order">show order (presentation)</em>
                        </div>
                      </div>
                      <span className={`podium-step ${i === 0 ? "podium-step--silver" : "podium-step--stone"}`} aria-hidden="true" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <p className="show-disclosure">
          {podiumPlacesFooter(draw.winners.length, rehearsal)}{" "}
          The rest of the finishing order is deterministic show flavor from the same seed, labeled wherever it
          appears.
        </p>
      </div>
    </Panel>
  );
}

/** The prize number with its count-up. It lands on exactly the amount the
 *  prize sentence reports; the sentence below carries the wording and the
 *  caveats. Skipped entirely when the split came out to zero. */
function PrizeAmount({ value, paid }: { value: bigint; paid: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const next = countUpT(now - start, 1100);
      setT(next);
      if (next < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <p className="podium-prize-line">
      <span className="podium-amount-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
          <path d="M7 3h10v4a5 5 0 0 1-10 0V3Z" fill="url(#podiumTrophyGold)" />
          <path d="M7 4.4H4.6a3.4 3.4 0 0 0 3.4 3.9M17 4.4h2.4a3.4 3.4 0 0 1-3.4 3.9" stroke="#facc15" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 12.2v3.9" stroke="#facc15" strokeWidth="2" strokeLinecap="round" />
          <rect x="8.6" y="16" width="6.8" height="2.1" rx="1.05" fill="#f5c542" />
          <rect x="7" y="18.9" width="10" height="2.3" rx="1.15" fill="#eab308" />
          <defs>
            <linearGradient id="podiumTrophyGold" x1="7" y1="3" x2="17" y2="12">
              <stop stopColor="#ffe066" />
              <stop offset="1" stopColor="#ff9d42" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span className="podium-amount">{formatAsset(countUpValue(0n, value, t))}</span>
      {paid && (
        <span className="podium-paid">
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none">
            <path d="M1.5 6.2 4.4 9 10.5 2.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          PAID
        </span>
      )}
    </p>
  );
}

function WinnerBlock({
  view,
  place,
  drawId,
  winnerTokens,
  potLabel,
  pot,
  eventsLabel,
  zeroPot,
  rehearsal,
  careerSource,
}: {
  view: WinnerView;
  place: number;
  drawId: string;
  winnerTokens: readonly bigint[];
  potLabel: string;
  pot: bigint;
  eventsLabel: string;
  zeroPot: boolean;
  rehearsal: boolean;
  careerSource: CareerSource;
}) {
  const racer = view.racer;
  const name = racer ? ipfsName(view.tokenId, racer.name, racer.metadataMissing) : null;
  const accent = place === 1 ? "gold" : place === 2 ? "silver" : "bronze";
  // A zero split is not a payment: the sentence says so instead of claiming
  // one. With prize money the copy names the per-winner share and its source;
  // a rehearsal says what award() would have done and that no money moved.
  const prizeSentence = podiumPrizeSentence({
    rehearsal,
    winners: winnerTokens,
    potLabel,
    zeroPot,
    team: racer?.team.state === "value" ? shortHex(racer.team.value, 10, 8) : null,
  });
  return (
    <div className={`podium-winner podium-winner--${accent}${place === 1 ? " podium-winner--hero" : ""}`} style={{ animationDelay: `${(place - 1) * 160}ms` }}>
      <div className="podium-shot">
        <span className="podium-spotlight" aria-hidden="true" />
        {place === 1 && (
          <span className="podium-crown" aria-hidden="true">
            <svg viewBox="0 0 32 24" width="56" height="42" fill="none">
              <path d="M3 19 1.5 7l7.2 4.6L16 3l7.3 8.6L30.5 7 29 19H3Z" fill="url(#podiumCrownGold)" stroke="#eab308" strokeWidth="1.2" strokeLinejoin="round" />
              <rect x="3.4" y="19.6" width="25.2" height="3.4" rx="1.7" fill="#eab308" />
              <defs>
                <linearGradient id="podiumCrownGold" x1="2" y1="4" x2="30" y2="20">
                  <stop stopColor="#ffe066" />
                  <stop offset="1" stopColor="#ff9d42" />
                </linearGradient>
              </defs>
            </svg>
          </span>
        )}
        {racer?.imageUrl && (
          <img src={racer.imageUrl} alt={`CHOG #${view.tokenId.toString()}`} className="podium-img" />
        )}
        <span className="podium-rank">{ordinalPlace(place)}</span>
      </div>
      <div>
        <p className="kicker">{winnerKickerLabel(drawId, rehearsal)}</p>
        <h3>
          CHOG #{view.tokenId.toString()}
          {name ? ` · IPFS metadata name: ${name}` : ""}
        </h3>
        {racer?.badge.state === "value" && (
          <Badge tone={racer.badge.value.badge === 2 ? "lime" : "neutral"}>{racer.badge.value.badgeLabel}</Badge>
        )}
        {racer?.badge.state === "failed" && <Badge tone="neutral">BADGE UNKNOWN</Badge>}
        {!zeroPot && <PrizeAmount value={pot} paid={!rehearsal} />}
        <p className="muted podium-prize">
          {prizeSentence}
          {eventsLabel ? ` ${eventsLabel}.` : ""}
        </p>
        {racer?.career && <p className="muted">{trophySentence(racer.career, view.inscription, careerSource)}</p>}
        {view.inscription && (
          <p className="show-inscription">
            INSCRIPTION EVENT: RaceRecorded at block {view.inscription.blockNumber.toString()} (tx{" "}
            {shortHex(view.inscription.txHash, 10, 8)}), placement {view.inscription.placement}.
          </p>
        )}
        <div className="hero-actions">
          <Button onClick={() => navigate("/verify")}>Re-derive this result</Button>
          <Button variant="outline" onClick={() => navigate("/spectator")}>Cheer the field</Button>
        </div>
      </div>
    </div>
  );
}
