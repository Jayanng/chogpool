// Deterministic confetti burst for the podium. The particle field is seeded
// from the draw's final randomness, so the celebration is as reproducible as
// the race it celebrates. Purely decorative.

import { useEffect, useRef } from "react";
import type { Hex } from "viem";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
};

const COLORS = ["#ff8a3d", "#c6ef6d", "#f4f6f8", "#e06a1e"];

/** Tiny deterministic PRNG seeded from the draw randomness. */
function seededRandom(seed: Hex): () => number {
  let state = 0;
  for (let i = 2; i < seed.length; i += 2) {
    state = (Math.imul(state, 31) + parseInt(seed.slice(i, i + 2), 16)) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function Confetti({ seed, active }: { seed: Hex; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;

    const rand = seededRandom(seed);
    const particles: Particle[] = [];
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: rand() * width,
        y: -rand() * height * 0.6,
        vx: (rand() - 0.5) * 2.2,
        vy: 1.6 + rand() * 2.6,
        size: 5 + rand() * 8,
        spin: (rand() - 0.5) * 0.25,
        angle: rand() * Math.PI * 2,
        color: COLORS[Math.floor(rand() * COLORS.length)],
      });
    }

    let frame = 0;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        if (p.y > height + 20) p.y = -20;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      frame += 1;
      if (frame < 900) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed, active]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
