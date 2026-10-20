// The Run: a playable race on the seeded course, with the ghost of the
// course's best run beside you. Every number on screen comes from the sim
// (game/sim.ts), and every run is replayable from its seed and its inputs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Stat } from "@chogpool/ui";
import { appearanceOf, type ChogAppearance } from "../race/chogArt";
import { courseOf, type PlacedObstacle } from "./course";
import { drawScene } from "./render";
import { coinsOf, initialRun, revive, step, type Input, type RunState } from "./sim";

const LEN = 45000;
const STEP_MS = 1000 / 60;
const GROUND_Y = 300;
const W = 860;
const H = 380;

type SavedRun = { seed: string; inputs: Input[]; score: number; distance: number; revived: boolean };
const BEST_KEY = "chogpool.best-run.v1";

/** Today's course: one seed for everyone playing today. The round contract
 *  replaces this with its on-chain courseSeed later. */
export function todaySeed(date = new Date()): string {
  return `chog-run-${date.toISOString().slice(0, 10)}`;
}

function loadBest(seed: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedRun;
    return saved.seed === seed ? saved : null;
  } catch {
    return null;
  }
}

type Phase = "ready" | "running" | "dead" | "cleared";

export function Runner({ appearance }: { appearance: ChogAppearance }) {
  const seed = useMemo(() => todaySeed(), []);
  const course: PlacedObstacle[] = useMemo(() => courseOf(seed, LEN), [seed]);
  const coins = useMemo(() => coinsOf(course, seed), [course, seed]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<RunState>(initialRun());
  const ghostRef = useRef<{ state: RunState; tape: Input[] } | null>(null);
  const inputsRef = useRef<Input[]>([]);
  const revivedRef = useRef(false);
  const keysRef = useRef({ jumpHeld: false, duck: false, jumpQueued: false });
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const [hud, setHud] = useState({ score: 0, coins: 0, closeCalls: 0, distance: 0, revived: false });
  const [best, setBest] = useState<SavedRun | null>(null);

  useEffect(() => {
    setBest(loadBest(seed));
  }, [seed]);

  // The ghost: the best recorded run on this exact course, stepped beside
  // the player from its input tape. Honest to the pixel: it is that run.
  const startGhost = useCallback(() => {
    const saved = loadBest(seed);
    if (!saved) {
      ghostRef.current = null;
      return;
    }
    ghostRef.current = { state: initialRun(), tape: saved.inputs };
  }, [seed]);

  const startRun = useCallback(() => {
    stateRef.current = initialRun();
    inputsRef.current = [];
    revivedRef.current = false;
    startGhost();
    phaseRef.current = "running";
    setPhase("running");
    setHud({ score: 0, coins: 0, closeCalls: 0, distance: 0, revived: false });
  }, [startGhost]);

  const doRevive = useCallback(() => {
    stateRef.current = revive(stateRef.current);
    revivedRef.current = true;
    phaseRef.current = "running";
    setPhase("running");
  }, []);

  // Input: keyboard and touch. Tap = jump, hold = higher, hold low = duck.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        keysRef.current.jumpQueued = true;
        keysRef.current.jumpHeld = true;
        if (phaseRef.current === "ready") startRun();
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        keysRef.current.duck = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") keysRef.current.jumpHeld = false;
      if (e.code === "ArrowDown" || e.code === "KeyS") keysRef.current.duck = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startRun]);

  const canvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const low = e.clientY - rect.top > rect.height * 0.62;
    if (phaseRef.current === "ready") startRun();
    if (low) {
      keysRef.current.duck = true;
    } else {
      keysRef.current.jumpQueued = true;
      keysRef.current.jumpHeld = true;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const canvasUp = () => {
    keysRef.current.jumpHeld = false;
    keysRef.current.duck = false;
  };

  // The loop: fixed 60Hz sim steps inside a display loop, so the physics is
  // identical on every machine and the replay stays exact.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(120, now - last);
      last = now;

      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        const s = stateRef.current;
        if (phaseRef.current === "running" && s.alive) {
          const input: Input = {
            jump: keysRef.current.jumpQueued,
            jumpHeld: keysRef.current.jumpHeld,
            duck: keysRef.current.duck,
          };
          keysRef.current.jumpQueued = false;
          inputsRef.current.push(input);
          stateRef.current = step(s, input, course, coins);

          const g = ghostRef.current;
          if (g && g.state.alive) {
            const gi = g.tape[g.state.frame] ?? { jump: false, jumpHeld: false, duck: false };
            g.state = step(g.state, gi, course, coins);
          }

          if (stateRef.current.juice > 0) stateRef.current.juice -= 1;

          const st = stateRef.current;
          if (st.distance >= LEN) {
            phaseRef.current = "cleared";
            setPhase("cleared");
          } else if (!st.alive) {
            phaseRef.current = "dead";
            setPhase("dead");
          }
          if (st.frame % 6 === 0) {
            setHud({
              score: st.score,
              coins: st.coins,
              closeCalls: st.closeCalls,
              distance: Math.floor(st.distance / 10),
              revived: revivedRef.current,
            });
          }
        }
      }

      // slow-motion juice: stretch frames while the tint is on
      const st = stateRef.current;
      drawScene(ctx, {
        width: W,
        height: H,
        appearance,
        state: st,
        course,
        coins,
        ghost: ghostRef.current ? { state: ghostRef.current.state, appearance } : null,
        groundY: GROUND_Y,
        seedLabel: seed,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [appearance, course, coins, seed]);

  // Save the best run on this course, for the next runner's ghost.
  const saveIfBest = useCallback(() => {
    const st = stateRef.current;
    const saved: SavedRun = {
      seed,
      inputs: inputsRef.current,
      score: st.score,
      distance: Math.floor(st.distance / 10),
      revived: revivedRef.current,
    };
    const prev = loadBest(seed);
    if (!prev || saved.score > prev.score) {
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(saved));
      } catch {
        // storage full or blocked: the run still stands, it just leaves no ghost
      }
      setBest(saved);
    }
  }, [seed]);

  useEffect(() => {
    if (phase === "dead" || phase === "cleared") saveIfBest();
  }, [phase, saveIfBest]);

  return (
    <div className="game-shell">
      <div className="game-frame">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="game-canvas"
          onPointerDown={canvasDown}
          onPointerUp={canvasUp}
          onPointerCancel={canvasUp}
          aria-label="The run. Space or tap to jump, hold to jump higher, down arrow or hold low to duck."
        />
        <div className="game-hud" aria-live="polite">
          <span className="game-hud-chip">SCORE {hud.score}</span>
          <span className="game-hud-chip">DISTANCE {hud.distance}m</span>
          <span className="game-hud-chip game-hud-chip--coin">TEST $CHOG × {hud.coins}</span>
          <span className="game-hud-chip">CLOSE {hud.closeCalls}</span>
          {hud.revived && <span className="game-hud-chip game-hud-chip--revived">REVIVED</span>}
        </div>

        {phase === "ready" && (
          <div className="game-overlay">
            <p className="game-overlay-title">The run is on</p>
            <p className="game-overlay-text">
              Space or tap to jump. Hold for the full arc. Duck under the gates.
              {best ? " The ghost beside you is your best run on this course." : " First run on this course is yours."}
            </p>
            <button className="btn btn-primary" onClick={startRun}>
              Start the run
            </button>
          </div>
        )}

        {phase === "dead" && (
          <div className="game-overlay">
            <p className="game-overlay-title">Down at {hud.distance}m</p>
            <p className="game-overlay-text">
              Score {hud.score}. {hud.closeCalls > 0 ? `${hud.closeCalls} close calls. ` : ""}
              Revive lifts you over the crash once, keeping this score.
            </p>
            <div className="game-overlay-actions">
              {!revivedRef.current ? (
                <button className="btn btn-primary" onClick={doRevive}>
                  Revive once
                </button>
              ) : (
                <span className="muted small">Revive already used in this run.</span>
              )}
              <button className="btn btn-secondary" onClick={startRun}>
                Run again
              </button>
            </div>
            <p className="game-overlay-foot">
              Replayable from this course seed and the run's inputs. Seed {seed}
            </p>
          </div>
        )}

        {phase === "cleared" && (
          <div className="game-overlay">
            <p className="game-overlay-title">Course clear</p>
            <p className="game-overlay-text">
              Score {hud.score}, {hud.coins} Test $CHOG collected, {hud.closeCalls} close calls.
            </p>
            <button className="btn btn-primary" onClick={startRun}>
              Run again
            </button>
          </div>
        )}
      </div>

      <div className="stat-row">
        <Stat label="COURSE" value="TODAY" note={`seed ${seed}`} />
        <Stat label="GHOST" value={best ? `SCORE ${best.score}` : "NONE YET"} note={best ? "your best on this course" : "set the first record"} />
        <Stat label="REVIVE" value="1 PER RUN" note="token fee settles with the round contract" />
      </div>
      <Card
        title="How the run is scored"
        footer="EVERY RUN IS REPLAYABLE FROM ITS SEED AND INPUTS"
      >
        <p className="muted small">
          Distance carries the score. Coins on the racing line are 25 points each and land in your
          Test $CHOG purse when the round contract is live. Close calls, passing an obstacle within
          a hand's width, pay 15 points and a flick of slow motion. The same seed always builds the
          same course, so the leaderboard compares skill, not luck.
        </p>
      </Card>
    </div>
  );
}
