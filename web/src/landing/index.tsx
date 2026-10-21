import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { Badge, Button, Card, Marquee, Panel, Stat, tokens } from "@chogpool/ui";
import { getGameSource } from "../lib/game";
import { readPodium, type PodiumRow } from "../lib/board";
import { readRound } from "../lib/rounds";
import { readWeekStandings, standingsNote, type WeekStandings } from "../lib/standings";
import { CHAIN } from "../generated/addresses.gen";
import { POT_DECIMALS } from "../types/game";
import { navigate } from "../lib/router";
import { todaySeed } from "../game/Runner";
import { courseOf } from "../game/course";
import tileCrowned from "./assets/c100.webp";
import tileHoodie from "./assets/c25.webp";

export default function Landing() {
  const [pot, setPot] = useState<bigint | null>(null);
  // Today's course, for the board's empty state: the real field the run
  // plays on, derived from today's published seed.
  const courseStats = useMemo(() => {
    const seed = todaySeed();
    const course = courseOf(seed, 45000);
    return { seed, obstacles: course.length };
  }, []);
  // The leaderboard's podium, read live from the CareerStore. null while
  // reading or after a failed read (said as such, never shown as empty),
  // [] when the board is genuinely empty. A row exists only when the store
  // recorded it.
  const [board, setBoard] = useState<PodiumRow[] | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  // This week's standings, ranked by score, read from the engine's score
  // events. null while reading, and a failed read is said as such: the list
  // must never be shown as "empty" when it is actually unreadable.
  const [week, setWeek] = useState<WeekStandings | null>(null);
  const [weekRound, setWeekRound] = useState<number | null>(null);
  const [weekFailed, setWeekFailed] = useState(false);
  const fixturesOn = import.meta.env.VITE_FIXTURES === "1";

  useEffect(() => {
    const source = getGameSource();
    if (!source) return;
    void source.potBalance().then(setPot);
  }, []);

  useEffect(() => {
    void readPodium()
      .then(setBoard)
      .catch(() => setBoardFailed(true));
  }, []);

  useEffect(() => {
    void readRound()
      .then((r) => {
        if (!r.ok) {
          setWeekFailed(true);
          return;
        }
        if (r.round === null) {
          setWeekRound(0);
          return;
        }
        setWeekRound(Number(r.round.id));
        void readWeekStandings(r.round.id).then((w) => (w ? setWeek(w) : setWeekFailed(true)));
      })
      .catch(() => setWeekFailed(true));
  }, []);

  const placeName = (place: number) => {
    if (boardFailed) return "BOARD UNREADABLE";
    if (board === null) return "READING…";
    const row = board.find((r) => r.place === place);
    return row ? `CHOG #${row.tokenId.toString()}` : "OPEN";
  };

  return (
    <div className="landing">
      <section className="hero hero-scene">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-confetti" aria-hidden="true">
          <svg style={{ left: "360px", top: "8px", width: "54px" }} viewBox="0 0 24 24" fill="#ffd84d"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" /></svg>
          <svg style={{ left: "250px", top: "26px", width: "30px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#f3a0c9" /></svg>
          <svg style={{ left: "700px", top: "24px", width: "30px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ff2d87" /></svg>
        </div>
        <div className="hero-copy">
          <div className="hero-chips">
            <span className="pill pill-dark">Skill game on Monad</span>
            <span className="pill pill-light">Test funds only</span>
          </div>
          <h1>
            <span className="line">Your stake</span>
            <span className="line">stays yours.</span>
            <span className="line">Your skill <em>wins the pot.</em></span>
          </h1>
          <p className="lede">A skill game for Chog holders. Enter with a stake, run the seeded course, and the top 3 split the pot. Your stake stays withdrawable, and every run is checkable by anyone.</p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/run")}>Play the game →</Button>
          </div>
          <div className="trust-row">
            <span className="chip"><span className="dot dot-green" />Principal safe</span>
            <span className="chip"><span className="dot dot-pink" />Real value only</span>
            <span className="chip"><span className="dot dot-yellow" />Re-derivable</span>
          </div>
        </div>

        <div className="hero-stage">
          <div className="sticker sticker-lg"><img src={tileCrowned} alt="Chog #100 from the Chog Genesis collection, crowned" /></div>
          <div className="sticker sticker-sm"><img src={tileHoodie} alt="Chog #25 from the Chog Genesis collection in a pink hood" /></div>
        </div>
      </section>

      <section className="hero-live">
        <Panel className="track-card">
          <div className="card-top">
            <span>GRAND PRIX</span>
            <Badge tone="neutral">THE LEADERBOARD</Badge>
          </div>
          <div className="track-footer"><span>PRIZE POT</span><strong>{pot === null ? "Reading the chain…" : `${formatUnits(pot, POT_DECIMALS)} USDC${fixturesOn ? " (fixture)" : ""}`}</strong></div>
          <div className="stat-row">
            <p className="kicker">THIS WEEK'S STANDINGS</p>
            {weekFailed ? (
              <p className="muted small">Could not read this week's standings from the chain. Refresh the page to try again.</p>
            ) : weekRound === 0 ? (
              <p className="muted small">No week is open yet. The next week appears here the moment it opens.</p>
            ) : week === null ? (
              <p className="muted small">Reading this week's standings…</p>
            ) : week.rows.length === 0 ? (
              <p className="muted small">No runs yet this week. Play one and it ranks here.</p>
            ) : (
              <ul className="rules-list">
                {week.rows.slice(0, 5).map((r, i) => (
                  <li key={r.tokenId.toString()}>
                    #{i + 1} Chog #{r.tokenId.toString()} · {r.score.toString()} pts · {r.coins.toString()} coins{r.revived ? " · revived" : ""}
                  </li>
                ))}
              </ul>
            )}
            {week !== null && <p className="track-note">{standingsNote(week)}</p>}
          </div>
          {board !== null && board.length > 0 && (
            <>
              <div className="lane lane-one"><div className="lane-label">1ST <span>{placeName(1)}</span></div><div className="runner runner-one">◉</div></div>
              <div className="lane lane-two"><div className="lane-label">2ND <span>{placeName(2)}</span></div><div className="runner runner-two">◉</div></div>
              <div className="lane lane-three"><div className="lane-label">3RD <span>{placeName(3)}</span></div><div className="runner runner-three">◉</div></div>
            </>
          )}
          {board !== null && board.length === 0 && !boardFailed && (
            <p className="track-note">The all-time board forms at the first settle. This week's top 3 land on it.</p>
          )}
          <p className="muted small">Today's course: 450m · {courseStats.obstacles} obstacles · the same field for everyone.</p>
          <Button onClick={() => navigate("/run")}>Play the game</Button>
        </Panel>
      </section>

      <Marquee items={["TOP 3 SPLIT THE POT", "SAME COURSE FOR EVERYONE", "EVERY RUN REPLAYABLE", "PRINCIPAL WITHDRAWABLE ANY TIME"]} tone="accent" />

      <section className="proof-grid">
        <div>
          <p className="kicker">THE PROMISE</p>
          <h2>Safe by design, checkable by anyone.</h2>
          <p className="muted">Your stake stays yours and stays withdrawable. The top 3 split the pot, and every run is checkable by anyone.</p>
        </div>
        <Panel className="proof-panel">
          <Stat label="THE ROSTER" value="1,969 Chogs" note="Every one is a playable athlete, and your entry binds to one of them." tone="lime" />
          <Stat label="FAIRNESS" value="Published seed" note="Run re-derivable from its published seed and inputs on the verifier page." />
        </Panel>
        <Panel className="proof-panel">
          <Stat label="TRY IT NOW" value="Test Drive" note="No Chog? Claim one clearly-labeled Test Chog and use the full site." tone="accent" />
          <Button variant="quiet" onClick={() => navigate("/setup")}>Set me up in 2 minutes ↗</Button>
        </Panel>
      </section>

      <section className="proof-grid">
        <div>
          <p className="kicker">HOW IT WORKS</p>
          <h2>Three steps, two minutes.</h2>
          <p className="muted">From an empty wallet to a proven run. Every step is a real transaction you sign.</p>
        </div>
        <Panel className="proof-panel">
          <Stat label="01 · SET ME UP" value="Two minutes" note="Faucet, swap, Test $CHOG, and a Test Chog minted as your runner, one guided button." tone="accent" />
          <Button variant="quiet" onClick={() => navigate("/setup")}>Start the setup ↗</Button>
        </Panel>
        <Panel className="proof-panel">
          <Stat label="02 · RUN THE COURSE" value="Your skill" note="Tap to jump, swipe to duck. Coins on the racing line, close calls pay, one revive." />
          <Button variant="quiet" onClick={() => navigate("/run")}>Play the game ↗</Button>
        </Panel>
        <Panel className="proof-panel">
          <Stat label="03 · PROVE THE RUN" value="The tape" note="Copy the record at the finish and watch every number recompute on the Proof page." tone="lime" />
          <Button variant="quiet" onClick={() => navigate("/verify")}>Open the Proof page ↗</Button>
        </Panel>
      </section>

      <section className="style-panel">
        <p className="kicker">THE FAIRNESS LAYER</p>
        <h2>Built for proof, designed for play.</h2>
        <p className="muted">Every run is a tape of presses on a published seed. The Proof page replays it and recomputes every number. The verifier is part of the experience, not a footnote.</p>
        {fixturesOn && <Badge tone="danger">DEV FIXTURE MODE · SIMULATED DATA</Badge>}
      </section>

      <Card title="Honest boundaries" footer="CLEAR LABELS, ALWAYS">
        <ul className="rules-list">
          <li>Test Drive Chogs are clearly labeled everywhere. They never blur into Verified Holder status.</li>
          <li>Traits are real off-chain IPFS metadata. Any boost mapping is our design, derived from real traits.</li>
          <li>The UI only displays what the chain and the run's simulation produce. It never invents a placement.</li>
        </ul>
      </Card>
    </div>
  );
}
