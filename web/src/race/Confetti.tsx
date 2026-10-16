// Deterministic confetti for the podium and the finish. The particle field is
// seeded from the draw's final randomness, so the celebration is as
// reproducible as the race it celebrates. Purely decorative.
//
// Two modes: "fall" bursts over the podium on mount and then settles into a
// top-heavy rain (dense up top, thinning downward, near and far pieces layered
// for depth), "burst" explodes outward from a point so the finish hit reads
// instantly. With prefers-reduced-motion the field renders once as a static
// sparse scatter and nothing moves.

import { useEffect, useRef } from "react";
import type { Hex } from "viem";
import { confettiDepthAlpha, confettiField, seededRandom } from "./visual";

// Track colors plus the brand band colors. These live in the decorative layer
// only: confetti, glows and rank accents, never in text or UI chrome.
const COLORS = ["#ff8a3d", "#c6ef6d", "#f4f6f8", "#e06a1e", "#FACC15", "#EC4899", "#2563EB", "#4f46e5"];

/** How fast the mount burst dies out; the fall takes over in about a second. */
const KICK_DECAY = 0.93;

export function Confetti({
  seed,
  active,
  count = 260,
  frames = 3600,
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

    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = seededRandom(seed, salt);
    // Reduced motion keeps the celebration but drops the movement: a quarter
    // of the pieces, laid out once, nothing animated.
    const particles = confettiField(
      rand,
      width,
      height,
      reduced ? Math.max(24, Math.floor(count / 4)) : count,
      mode,
    );

    const drawPieces = () => {
      for (const p of particles) {
        // The field decays downward: pieces fade out near the bottom so the
        // rain stays dense at the top and the floor reads clean.
        const fallOff = p.y < height * 0.62 ? 1 : Math.max(0, 1 - (p.y - height * 0.62) / (height * 0.5));
        if (fallOff <= 0) continue;
        ctx.save();
        ctx.globalAlpha = confettiDepthAlpha(p.depth) * fallOff;
        // Near pieces sit closest to the camera, so they carry a touch of
        // softness; far pieces stay crisp and dim like distant flakes.
        if (p.depth === 2) ctx.filter = "blur(2.4px)";
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = COLORS[p.colorIndex % COLORS.length];
        if (p.streamer) {
          ctx.fillRect(-p.size * 1.6, -p.size / 4, p.size * 3.2, p.size / 2);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }
        ctx.restore();
      }
    };

    if (reduced) {
      ctx.clearRect(0, 0, width, height);
      drawPieces();
      return;
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
          // The mount kick dies out and the fall takes over.
          p.kickX *= KICK_DECAY;
          p.kickY *= KICK_DECAY;
          // A little sideways sway so the fall reads as flutter, not rain.
          p.x += p.vx + p.kickX + Math.sin((frame + p.y) * 0.04) * 0.5;
          p.y += p.vy + p.kickY;
          if (p.y > height + 20) {
            // Re-enter along the top, keeping the field top-heavy over time.
            p.x = (p.x * 1.618 + width * 0.37) % width;
            p.y = -20 - ((p.x * 0.31) % 1) * height * 0.2;
            p.kickX = 0;
            p.kickY = 0;
          }
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
        }
        p.angle += p.spin;
      }
      drawPieces();
      frame += 1;
      if (frame < frames) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed, active, count, frames, mode, salt]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
