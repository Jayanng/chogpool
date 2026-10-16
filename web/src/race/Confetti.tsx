// Deterministic confetti for the podium and the finish. The particle field is
// seeded from the draw's final randomness, so the celebration is as
// reproducible as the race it celebrates. Purely decorative.
//
// Two modes: "fall" rains confetti down over the podium, "burst" explodes it
// outward from a point so the finish hit reads instantly.

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
  streamer: boolean;
};

// Track colors plus the brand band colors. These live in the decorative layer
// only: confetti, glows and rank accents, never in text or UI chrome.
const COLORS = ["#ff8a3d", "#c6ef6d", "#f4f6f8", "#e06a1e", "#FACC15", "#EC4899", "#2563EB", "#4f46e5"];

/** Tiny deterministic PRNG seeded from the draw randomness, with an optional
 *  salt so two celebrations of the same draw never scatter identically. */
function seededRandom(seed: Hex, salt = 0): () => number {
  let state = salt >>> 0;
  for (let i = 2; i < seed.length; i += 2) {
    state = (Math.imul(state, 31) + parseInt(seed.slice(i, i + 2), 16)) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function Confetti({
  seed,
  active,
  count = 200,
  frames = 900,
  mode = "fall",
  salt = 0,
}: {
  seed: Hex;
  active: boolean;
  /** Particle count; the burst at the finish uses a smaller, shorter field. */
  count?: number;
  /** How many animation frames the field lives. */
  frames?: number;
  /** "fall" rains over the podium; "burst" explodes from the finish point. */
  mode?: "fall" | "burst";
  /** Mixes the seed per surface so each burst scatters its own way. */
  salt?: number;
}) {
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

    const rand = seededRandom(seed, salt);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const color = COLORS[Math.floor(rand() * COLORS.length)];
      const streamer = rand() > 0.55;
      const size = 6 + rand() * 10;
      if (mode === "burst") {
        // Explode outward from just left of the checkered line.
        const angle = rand() * Math.PI * 2;
        const speed = 2 + rand() * 6.5;
        particles.push({
          x: width * 0.9,
          y: height * 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2.5,
          size,
          spin: (rand() - 0.5) * 0.35,
          angle,
          color,
          streamer,
        });
      } else {
        // Already partway down the field so the podium reads at once.
        particles.push({
          x: rand() * width,
          y: rand() * height * 0.7 - height * 0.35,
          vx: (rand() - 0.5) * 2.2,
          vy: 1.6 + rand() * 2.6,
          size,
          spin: (rand() - 0.5) * 0.25,
          angle: rand() * Math.PI * 2,
          color,
          streamer,
        });
      }
    }

    let frame = 0;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      if (mode === "burst" && frame < 30) {
        // The blast itself: a hot core and an expanding ring at the crossing
        // point, fading as the confetti flies out, so the burst reads as one
        // event instead of background sprinkle.
        const fade = 1 - frame / 30;
        const gx = width * 0.9;
        const gy = height * 0.5;
        const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, width * 0.3);
        glow.addColorStop(0, `rgba(255, 236, 190, ${0.55 * fade})`);
        glow.addColorStop(0.45, `rgba(255, 160, 80, ${0.26 * fade})`);
        glow.addColorStop(1, "rgba(255, 160, 80, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        ctx.beginPath();
        ctx.arc(gx, gy, width * (0.06 + frame * 0.016), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 240, 210, ${0.5 * fade})`;
        ctx.lineWidth = 3 + 8 * fade;
        ctx.stroke();
      }
      for (const p of particles) {
        if (mode === "burst") {
          p.vy += 0.22; // gravity pulls the blast down
          p.vx *= 0.985;
          p.x += p.vx;
          p.y += p.vy;
        } else {
          // A little sideways sway so the fall reads as flutter, not rain.
          p.x += p.vx + Math.sin((frame + p.y) * 0.04) * 0.5;
          p.y += p.vy;
          if (p.y > height + 20) p.y = -20;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
        }
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        if (p.streamer) {
          ctx.fillRect(-p.size * 1.6, -p.size / 4, p.size * 3.2, p.size / 2);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }
        ctx.restore();
      }
      frame += 1;
      if (frame < frames) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed, active, count, frames, mode, salt]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
