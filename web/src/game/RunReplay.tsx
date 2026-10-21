// The replay stage: a run's tape played back on the stage, with the story's
// commentary ticker and the finish margin. This is the celebration layer for
// runs, the replacement for the draw-era race show. It shows nothing the
// record does not contain: every frame is the sim replaying the tape.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChogAppearance } from "../race/chogArt";
import { courseOf, type PlacedObstacle } from "./course";
import { drawScene } from "./render";
import { runStory, type RunStory } from "./replay";
import type { RunRecord } from "./runRecord";
import { coinsOf, type RunState } from "./sim";

const STEP_MS = 1000 / 60;
const GROUND_Y = 300;
const W = 860;
const H = 380;

export function RunReplay({
  record,
  ghost,
  appearance,
  imageUrl,
}: {
  record: RunRecord;
  ghost?: RunRecord | null;
  appearance: ChogAppearance;
  imageUrl?: string | null;
}) {
  const story: RunStory = useMemo(() => runStory(record, ghost ?? null), [record, ghost]);
  const ghostFrames: RunState[] | null = useMemo(
    () => (ghost ? runStory(ghost, null).frames : null),
    [ghost],
  );
  // The field the run happened on: same seed, same course, same coins.
  const course: PlacedObstacle[] = useMemo(() => courseOf(record.seed, record.lengthPx), [record.seed, record.lengthPx]);
  const coins = useMemo(() => coinsOf(course, record.seed), [course, record.seed]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const idxRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const [ticker, setTicker] = useState(story.events[0]?.text ?? "The run begins.");
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

  // Replay from the start whenever the record changes.
  useEffect(() => {
    idxRef.current = 0;
    setPlaying(true);
    setDone(false);
    setTicker(story.events[0]?.text ?? "The run begins.");
  }, [story]);

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
        if (!playing) continue;
        if (idxRef.current < story.frames.length - 1) {
          idxRef.current += 1;
          const st = story.frames[idxRef.current];
          // the story's line for this moment
          for (const e of story.events) {
            if (e.at <= st.distance) setTicker(e.text);
          }
        } else if (!done) {
          setDone(true);
          setPlaying(false);
        }
      }

      const st = story.frames[idxRef.current] ?? story.frames[0];
      const g = ghostFrames ? ghostFrames[Math.min(idxRef.current, ghostFrames.length - 1)] : null;
      if (st) {
        drawScene(ctx, {
          width: W,
          height: H,
          appearance,
          state: st,
          course,
          coins,
          ghost: g ? { state: g, appearance } : null,
          groundY: GROUND_Y,
          seedLabel: record.seed,
          playerImage: image,
          ghostImage: image,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [story, ghostFrames, appearance, image, playing, done, record.seed, course, coins]);

  return (
    <div className="game-shell">
      <div className="game-frame">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="game-canvas"
          aria-label="Run replay. The tape plays exactly as it was run."
        />
        <div className="game-hud" aria-live="polite">
          <span className="game-hud-chip">SCORE {story.score}</span>
          <span className="game-hud-chip">DISTANCE {Math.floor(story.distance / 10)}m</span>
          <span className="game-hud-chip game-hud-chip--coin">TEST $CHOG × {story.coins}</span>
          {story.revived && <span className="game-hud-chip game-hud-chip--revived">REVIVED</span>}
          {story.marginLabel && <span className="game-hud-chip">{story.marginLabel}</span>}
        </div>
        {story.marginLabel && done && (
          <div className="game-overlay game-overlay--stamp">
            <p className="game-overlay-title">{story.marginLabel}</p>
            <p className="game-overlay-text">
              {story.cleared ? "The course was cleared." : `Down at ${Math.floor(story.distance / 10)}m.`}{" "}
              Every number here recomputes from the seed and the tape.
            </p>
          </div>
        )}
      </div>
      <div className="stat-row">
        <button className="btn btn-secondary" onClick={() => setPlaying((p) => !p)} disabled={done}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            idxRef.current = 0;
            setDone(false);
            setPlaying(true);
            setTicker(story.events[0]?.text ?? "The run begins.");
          }}
        >
          Replay
        </button>
        <p className="muted small">{ticker}</p>
      </div>
    </div>
  );
}
