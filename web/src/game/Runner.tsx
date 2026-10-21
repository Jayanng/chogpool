// The Run: a playable race on the seeded course, with the ghost of the
// course's best run beside you. Every number on screen comes from the sim
// (game/sim.ts), and every run is replayable from its seed and its inputs.
//
// Controls: tap or press space to jump, hold for the full arc, swipe down
// (or press down) to duck. The canvas is DPI-crisp and takes a taller,
// closer camera on narrow screens, so the game is the same game on a phone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Stat } from "@chogpool/ui";
import { type ChogAppearance } from "../race/chogArt";
import { courseOf, type PlacedObstacle } from "./course";
import { drawScene, spawnBurst, spawnConfetti, spawnDust, type Particle, type Popup } from "./render";
import { buildRunRecord } from "./runRecord";
import { coinsOf, initialRun, revive, step, type Input, type RunState } from "./sim";
import { playCue } from "../lib/sound";

const LEN = 45000;
const STEP_MS = 1000 / 60;

type SavedRun = {
  seed: string;
  inputs: Input[];
  score: number;
  distance: number;
  revived: boolean;
  /** where the one revive happened in the tape, for a faithful ghost */
  reviveAt?: number | null;
  /** the sim's own numbers, so the saved run is also a verifiable record */
  distancePx?: number;
  coins?: number;
  closeCalls?: number;
};
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

/** The saved best run on a course, for the Replays stage. */
export function loadBestRun(seed: string): SavedRun | null {
  return loadBest(seed);
}

export type { SavedRun };

type Phase = "ready" | "running" | "dead" | "cleared";

export function Runner({ appearance, imageUrl }: { appearance: ChogAppearance; imageUrl?: string | null }) {
  const seed = useMemo(() => todaySeed(), []);
  const course: PlacedObstacle[] = useMemo(() => courseOf(seed, LEN), [seed]);
  const coins = useMemo(() => coinsOf(course, seed), [course, seed]);

  // The Chog's real image. Until it loads (or if it never does) the renderer
  // falls back to the derived sprite, exactly like the race show does.
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!imageUrl) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = imageUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ scale: 1, logicalW: 940, logicalH: 430, groundY: 318 });
  const stateRef = useRef<RunState>(initialRun());
  const ghostRef = useRef<{ state: RunState; tape: Input[]; reviveAt: number | null; revivedUsed: boolean } | null>(null);
  const inputsRef = useRef<Input[]>([]);
  const revivedRef = useRef(false);
  const reviveAtRef = useRef<number | null>(null);
  const keysRef = useRef({ jumpHeld: false, duck: false, jumpQueued: false });
  const particlesRef = useRef<Particle[]>([]);
  const popupsRef = useRef<Popup[]>([]);
  const shakeRef = useRef(0);
  const ptrRef = useRef({ id: -1, startY: 0, swiped: false });
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const [hud, setHud] = useState({ score: 0, coins: 0, closeCalls: 0, distance: 0, revived: false });
  const [best, setBest] = useState<SavedRun | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setBest(loadBest(seed));
  }, [seed]);

  // Responsive canvas: crisp on every screen, a closer camera on phones.
  useEffect(() => {
    const el = frameRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const compute = () => {
      const cssW = el.clientWidth || 900;
      const narrow = cssW < 680;
      const cssH = narrow
        ? Math.min(cssW * 1.18, (window.innerHeight || 700) * 0.72)
        : cssW * 0.46;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const renderScale = cssW / (narrow ? 560 : 940);
      const logicalW = cssW / renderScale;
      const logicalH = cssH / renderScale;
      dimsRef.current = { scale: renderScale * dpr, logicalW, logicalH, groundY: logicalH * 0.74 };
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

  // The ghost: the best recorded run on this exact course, stepped beside
  // the player from its input tape. Honest to the pixel: it is that run.
  const startGhost = useCallback(() => {
    const saved = loadBest(seed);
    if (!saved) {
      ghostRef.current = null;
      return;
    }
    ghostRef.current = {
      state: initialRun(),
      tape: saved.inputs,
      reviveAt: saved.reviveAt ?? null,
      revivedUsed: false,
    };
  }, [seed]);

  const startRun = useCallback(() => {
    stateRef.current = initialRun();
    inputsRef.current = [];
    revivedRef.current = false;
    reviveAtRef.current = null;
    particlesRef.current = [];
    popupsRef.current = [];
    shakeRef.current = 0;
    setCopied(null);
    startGhost();
    phaseRef.current = "running";
    setPhase("running");
    setHud({ score: 0, coins: 0, closeCalls: 0, distance: 0, revived: false });
    playCue("gates");
  }, [startGhost]);

  const doRevive = useCallback(() => {
    stateRef.current = revive(stateRef.current);
    revivedRef.current = true;
    // The tape index where the revive happened: the next pressed input
    // continues the run after this point.
    reviveAtRef.current = inputsRef.current.length;
    phaseRef.current = "running";
    setPhase("running");
    shakeRef.current = 0.7;
    playCue("fanfare");
  }, []);

  // The run record: what a verifier needs to replay this exact run. Copied
  // at the finish line so nobody has to trust a screenshot.
  const copyRecord = useCallback(async () => {
    const st = stateRef.current;
    const record = buildRunRecord({
      seed,
      lengthPx: LEN,
      state: st,
      inputs: inputsRef.current,
      reviveAt: reviveAtRef.current,
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(record));
      setCopied("Run record copied. Paste it on the Proof page to re-run it.");
    } catch {
      setCopied("The browser blocked the clipboard. The record is below, select and copy it.");
    }
  }, [seed]);

  // Input: keyboard and gestures. Tap = jump, hold = higher, swipe down or
  // press down = duck. The whole frame is the touch target.
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

  const frameDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current === "dead" || phaseRef.current === "cleared") return;
    const p = ptrRef.current;
    p.id = e.pointerId;
    p.startY = e.clientY;
    p.swiped = false;
    if (phaseRef.current === "ready") startRun();
    keysRef.current.jumpQueued = true;
    keysRef.current.jumpHeld = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const frameMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = ptrRef.current;
    if (p.id !== e.pointerId || p.swiped) return;
    if (e.clientY - p.startY > 36) {
      // a deliberate downward swipe is the duck gesture
      p.swiped = true;
      keysRef.current.jumpHeld = false;
      keysRef.current.duck = true;
    }
  };
  const frameUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ptrRef.current.id !== e.pointerId) return;
    ptrRef.current.id = -1;
    keysRef.current.jumpHeld = false;
    keysRef.current.duck = false;
  };

  // The loop: fixed 60Hz sim steps inside a display loop, so the physics is
  // identical on every machine and the replay stays exact. Close calls run
  // the clock at half speed for a beat: presentation only, the tape is
  // unaffected because the tape is per step, not per second.
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
      const st0 = stateRef.current;
      const dilation = st0.juice > 0 ? 0.5 : 1;
      acc += Math.min(120, now - last) * dilation;
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
          const before = s;
          stateRef.current = step(s, input, course, coins);
          const st = stateRef.current;
          const { logicalW, groundY } = dimsRef.current;
          const playerX = logicalW * 0.26 + 18;

          // effects, all presentation: the sim's numbers are untouched
          if (st.alive && st.height === 0 && st.frame % 14 === 0) {
            spawnDust(particlesRef.current, playerX, groundY + 2, 2);
          }
          if (before.height > 3 && st.height === 0) {
            spawnDust(particlesRef.current, playerX, groundY + 2, 7);
            shakeRef.current = Math.max(shakeRef.current, 0.22);
          }
          if (st.coins > before.coins) {
            spawnBurst(particlesRef.current, playerX + 10, groundY - st.height - 30, "#c6e85c", 10);
            popupsRef.current.push({ x: playerX + 20, y: groundY - st.height - 52, text: "+25", life: 42, color: "#c6e85c" });
          }
          if (st.closeCalls > before.closeCalls) {
            popupsRef.current.push({ x: playerX + 26, y: groundY - st.height - 66, text: "CLOSE! +15", life: 52, color: "#ffd84d" });
            shakeRef.current = Math.max(shakeRef.current, 0.55);
          }
          if (before.alive && !st.alive) {
            spawnBurst(particlesRef.current, playerX + 10, groundY - st.height - 28, "#f0679c", 18, 4.2);
            shakeRef.current = 1;
          }

          const g = ghostRef.current;
          if (g) {
            // The ghost lives its recorded run, including its one revive.
            if (!g.state.alive && g.reviveAt !== null && !g.revivedUsed) {
              g.state = revive(g.state);
              g.revivedUsed = true;
            }
            if (g.state.alive) {
              const gi = g.tape[g.state.frame] ?? { jump: false, jumpHeld: false, duck: false };
              g.state = step(g.state, gi, course, coins);
            }
          }

          if (stateRef.current.juice > 0) stateRef.current.juice -= 1;

          if (st.distance >= LEN) {
            phaseRef.current = "cleared";
            setPhase("cleared");
            spawnConfetti(particlesRef.current, playerX + 60, groundY - 140);
            playCue("finish");
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

      const st = stateRef.current;
      const dims = dimsRef.current;
      shakeRef.current = Math.max(0, shakeRef.current - 0.045);
      drawScene(ctx, {
        width: dims.logicalW,
        height: dims.logicalH,
        scale: dims.scale,
        appearance,
        state: st,
        course,
        coins,
        ghost: ghostRef.current ? { state: ghostRef.current.state, appearance } : null,
        groundY: dims.groundY,
        seedLabel: seed,
        playerImage: image,
        ghostImage: image,
        particles: particlesRef.current,
        popups: popupsRef.current,
        shake: shakeRef.current,
        progress: Math.min(1, st.distance / LEN),
        lengthPx: LEN,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [appearance, course, coins, seed, image]);

  // Save the best run on this course, for the next runner's ghost.
  const saveIfBest = useCallback(() => {
    const st = stateRef.current;
    const saved: SavedRun = {
      seed,
      inputs: inputsRef.current,
      score: st.score,
      distance: Math.floor(st.distance / 10),
      revived: revivedRef.current,
      reviveAt: reviveAtRef.current,
      distancePx: st.distance,
      coins: st.coins,
      closeCalls: st.closeCalls,
    };
    const prev = loadBest(seed);
    if (!prev || saved.score > prev.score) {
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify({ ...saved, reviveAt: reviveAtRef.current }));
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
      <div
        className="game-frame"
        ref={frameRef}
        onPointerDown={frameDown}
        onPointerMove={frameMove}
        onPointerUp={frameUp}
        onPointerCancel={frameUp}
      >
        <canvas
          ref={canvasRef}
          className="game-canvas"
          aria-label="The run. Tap or press space to jump, hold to jump higher, swipe down or press down to duck."
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
              Tap anywhere to jump. Hold for the full arc. Swipe down to duck under the gates.
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
              <button className="btn btn-secondary" onClick={() => void copyRecord()}>
                Copy run record
              </button>
            </div>
            <p className="game-overlay-foot">
              Replayable from this course seed and the run's inputs. Seed {seed}
              {copied ? ` · ${copied}` : ""} Send the copied run record to the keeper to rank in
              this week's standings.
            </p>
          </div>
        )}

        {phase === "cleared" && (
          <div className="game-overlay">
            <p className="game-overlay-title">Course clear</p>
            <p className="game-overlay-text">
              Score {hud.score}, {hud.coins} Test $CHOG collected, {hud.closeCalls} close calls.
            </p>
            <div className="game-overlay-actions">
              <button className="btn btn-primary" onClick={startRun}>
                Run again
              </button>
              <button className="btn btn-secondary" onClick={() => void copyRecord()}>
                Copy run record
              </button>
            </div>
            {copied && <p className="game-overlay-foot">{copied}</p>}
            <p className="game-overlay-foot">
              Send the copied run record to the keeper to rank in this week's standings.
            </p>
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
          Test $CHOG purse at 0.1 Test $CHOG per coin the moment your run is recorded on chain. Close calls, passing an obstacle within
          a hand's width, pay 15 points and a beat of slow motion. The same seed always builds the
          same course, so the leaderboard compares skill, not luck.
        </p>
      </Card>
    </div>
  );
}
